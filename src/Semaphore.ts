import { Future } from '@pedromsilva/data-future'

export interface SemahporeQueue<T> {
    reject ( reason : any ) : void;

    resolve ( value : T | PromiseLike<T> ) : void;

    released : boolean;
}

export interface SemaphoreRelease {
    () : void;
}

export interface SemaphoreLike {
    isLocked : boolean;

    acquire () : Promise<SemaphoreRelease>;

    release () : void;

    use<T> ( fn : () => T | PromiseLike<T> ) : Promise<T>;    
}

export class Semaphore implements SemaphoreLike {
    protected queue : Future<SemaphoreRelease>[] = [];

    public count : number;

    public acquired : number = 0;

    constructor ( count : number ) {
        this.count = count;
    }

    get isLocked () : boolean {
        return this.count <= 0;
    }

    acquire () : Promise<SemaphoreRelease> {
        this.count--;
        this.acquired++;

        if ( this.count >= 0 ) {
            return Promise.resolve( this.release.bind( this ) );
        }

        const future = new Future<SemaphoreRelease>();
        
        this.queue.push( future );

        return future.promise;
    }

    release () : void {
        this.count++;
        this.acquired--;
        
        if ( this.queue.length > 0 ) {
            this.count--;
            this.acquired++;

            this.queue.shift().resolve( this.release.bind( this ) );
        }
    }

    async use<T> ( fn : () => T | PromiseLike<T> ) : Promise<T> {
        const release = await this.acquire();

        try {
            return await fn();
        } finally {
            release();            
        }
    }
}

export class SemaphorePool<T> {
    semaphores : Map<T, Semaphore> = new Map();

    count : number;

    autoRemove : boolean;

    constructor ( count : number, autoRemove : boolean = true ) {
        this.count = count;
        this.autoRemove = autoRemove;
    }

    isLocked ( key : T ) : boolean {
        const sem = this.semaphores.get( key );
        
        return sem && sem.isLocked;
    }

    async acquire ( object : T ) : Promise<SemaphoreRelease> {
        let semaphore = this.semaphores.get( object );

        if ( !semaphore ) {
            semaphore = new Semaphore( this.count );

            this.semaphores.set( object, semaphore );
        }

        await semaphore.acquire();

        return this.release.bind( this, object );
    }

    release ( object : T ) : void {
        let semaphore = this.semaphores.get( object );

        if ( !semaphore && !this.autoRemove ) {
            semaphore = new Semaphore( this.count );

            this.semaphores.set( object, semaphore );
        }

        if ( semaphore ) {
            semaphore.release();

            if ( semaphore.count >= this.count && this.autoRemove ) {
                this.semaphores.delete( object );
            }
        }
    }

    async use<V> ( object : T, fn : () => V | PromiseLike<V> ) : Promise<V> {
        let release = await this.acquire( object );

        try {
            return await fn();
        } finally {
            release();
        }
    }
}

export class SemaphorePoolHandle<K = any> implements SemaphoreLike {
    protected pool : SemaphorePool<K>;

    protected name : K;

    constructor ( pool : SemaphorePool<K>, name : K ) {
        this.pool = pool;
        this.name = name;
    }

    get isLocked () : boolean {
        return this.pool.isLocked( this.name );
    }

    acquire () : Promise<SemaphoreRelease> {
        return this.pool.acquire( this.name );
    }
    release () : void {
        return this.pool.release( this.name );
    }

    use<T> ( fn : () => T | PromiseLike<T> ) : Promise<T> {
        return this.pool.use( this.name, fn );
    }
}

export class Mutex extends Semaphore {
    constructor () {
        super( 1 );
    }
}

export class MutexPool<T> extends SemaphorePool<T> {
    constructor () {
        super( 1 );
    }
}

export function Synchronized<T> ( count : number = 1, getter ?: ( ...args : any[] ) => T ) {
    if ( getter ) {
        return ( target : Object, key : string | symbol, descriptor : TypedPropertyDescriptor<Function> ) => {
            let semaphoreMap : SemaphorePool<T> = new SemaphorePool( count );

            return {
                value: function ( ...args : any[] ) {
                    const object = getter.apply( this, args );

                    return semaphoreMap.use( object, () => descriptor.value.apply( this, args ) );
                }
            };
        };
    } else {
        return ( target : Object, key : string | symbol, descriptor : TypedPropertyDescriptor<Function> ) => {
            let semaphore = new Semaphore( count );

            return {
                value: function( ... args: any[]) {
                    return semaphore.use( () => descriptor.value.apply( this, args ) );
                }
            };
        };
    }
}

export function SynchronizedBy ( semaphore : SemaphoreLike | ( ( self : any, ...args : any[] ) => SemaphoreLike ) ) {
    let getter : ( ...args : any[] ) => SemaphoreLike;

    if ( typeof semaphore != 'function' ) {
        getter = () => semaphore;
    } else {
        getter = semaphore;
    }
    
    return ( target : object, key : string | symbol, descriptor : TypedPropertyDescriptor<Function> ) => {
        return {
            value: function( ...args: any[]) {
                return getter( this, ...args ).use( () => descriptor.value.apply( this, args ) );
            }
        };
    };
}

export function Batched ( semaphore ?: SemaphoreLike | ( ( self : any, ...args : any[] ) => SemaphoreLike ) ) {
    let getter : ( ...args : any[] ) => SemaphoreLike;

    if ( !semaphore ) {
        const tmp = new Semaphore( 1 );

        getter = () => tmp;
    } else if ( typeof semaphore != 'function' ) {
        getter = () => semaphore;
    } else {
        getter = semaphore;
    }
    
    const calls : Map<SemaphoreLike, any> = new Map();

    return ( target : object, key : string | symbol, descriptor : TypedPropertyDescriptor<Function> ) => {
        return {
            value: async function ( ...args: any[] ) {
                const sem = getter( this, ...args );

                if ( calls.has( sem ) ) {
                    return calls.get( sem );
                }
                
                const promise = sem.use( () => descriptor.value.apply( this, args ) );

                calls.set( sem, promise );

                try {
                    return await promise;
                } finally {
                    calls.delete( sem );                    
                }
            }
        };
    };
}

/**
 * Semaphore that reuses the same lock if the key is the same as the last one.
 * When a new key is provided, a new 
 * 
 * @export
 * @class StackedSemaphore
 * @template K 
 */
export class StackedSemaphore<K> {
    protected semaphore : Semaphore = new Semaphore( 1 );

    protected counts : number[] = [];

    protected lastAcquired : Promise<SemaphoreRelease>;

    protected lastKey : K;

    isLast ( blocker : K ) : boolean {
        return this.lastKey == blocker;
    }

    async acquire ( key : K ) {
        // If there is a lock acquired, and the key matches, increment the counter
        // The counter is used so that when the release method is called,
        // Only the last call actually releases the lock, since only the first
        // call actually acquired the lock too
        if ( this.lastAcquired && key == this.lastKey ) {
            this.counts[ this.counts.length - 1 ]++;

            await this.lastAcquired;

            return this.release.bind( this );
        }

        // If the key is different, add the number 1 to the counter
        // The one represents this acquire call
        this.counts.push( 1 );

        this.lastAcquired = this.semaphore.acquire();

        this.lastKey = key;

        await this.lastAcquired;

        return this.release.bind( this );
    }

    release () {
        // Since this is a stack, it mimicks a FIFO behavior
        // That means that any release call has to corresponde to the first acquire
        // Any release from any other acquires, by definition (since this is a mutex)
        // have to wait until the first lock is fully release (when the counter reaches zero)
        this.counts[ 0 ]--;

        if ( this.counts[ 0 ] == 0 ) {
            this.semaphore.release();
    
            // This semaphore is release, so we should start decrementing the counts of the next lock
            this.counts.splice( 0, 1 );

            // If there are no further locks we can erase the cached locks
            // Any further locks, regardless of the key used, can be started right away
            // Since the lock is free
            if ( this.counts.length == 0 ) {
                this.lastKey = null;
    
                this.lastAcquired = null;
            }
        }
    }
}

export class PhasedSemaphore implements SemaphoreLike {
    semaphores : Semaphore[];
    
    available : StackedSemaphore<string> = new StackedSemaphore();

    isLocked: boolean;

    count : number;

    constructor ( count : number ) {
        this.semaphores = [ new Semaphore( count ) ];

        this.count = count;
    }

    async lock ( blocker : string ) {
        if ( !this.available.isLast( blocker ) ) {
            this.semaphores.push( new Semaphore( this.count ) );
        }

        return this.available.acquire( blocker );
    }

    unlock () {
        this.available.release();

        if ( this.semaphores.length > 1 && this.semaphores[ 0 ].acquired === 0 ) {
            this.semaphores.splice( 0, 1 );
        }
    }

    async acquire () : Promise<SemaphoreRelease> {
        const sem = this.semaphores[ this.semaphores.length - 1 ];

        if ( sem.acquired === 0 ) {
            await this.available.acquire( null );
        }

        await sem.acquire();

        return this.release.bind( this ) as SemaphoreRelease;
    }

    release () : void {
        const sem = this.semaphores[ 0 ];

        sem.release();

        this.available.release();

        if ( sem.acquired == 0 ) {
            if ( this.semaphores.length > 1 ) {
                this.semaphores.splice( 0, 1 );
            }
        }
    }

    async use <T> ( fn: () => T | PromiseLike<T> ) : Promise<T> {
        const release = await this.acquire();

        try {
            return await fn();
        } finally {
            release();
        }
    }
}

export class StateLaneSemaphore implements SemaphoreLike {
    protected parent : StateSemaphore;

    protected name : string;

    protected semaphore : PhasedSemaphore;

    blocks : string[];

    isLocked: boolean;

    constructor ( states : StateSemaphore, name : string, blocks : string[] = [], count : number = Infinity ) {
        this.parent = states;
        this.name = name;
        this.blocks = blocks;
        this.semaphore = new PhasedSemaphore( count );
    }

    lock ( name : string ) {
        return this.semaphore.lock( name );
    }

    unlock ( name : string ) {
        this.semaphore.unlock();
    }

    async acquire () : Promise<SemaphoreRelease> {
        await Promise.all( [ this.semaphore.lock( null ), this.semaphore.acquire(), ...this.blocks.map( name => this.parent.getLane( name ).lock( this.name ) ) ] );

        return this.release.bind( this );
    }

    release () : void {
        this.blocks.map( name => this.parent.getLane( name ).unlock( this.name ) );
        this.semaphore.unlock();

        this.semaphore.release();
    }

    async use <T> ( fn : () => T | PromiseLike<T> ) : Promise<T> {
        const release = await this.acquire();

        try {
            return await fn();
        } finally {
            release();
        }
    }
}

/**
 * A semaphore map that allows some semaphores to block others. For instance, useful in
 * implementing a ReadWriteSemaphore that migth have infinite concurrent reads, but only one
 * concurrent write, and that the write semaphore blocks the read semaphores until it is done.
 * 
 * This semaphore garantees the execution order matches the acquire order, and thus the
 * non-starvation of the resources: even if there are consistently reads in queue to be executed,
 * writes will be executed before any other lock that was only acquired after it.
 * 
 * let states = new StateSemaphore( [
 *  [ 'read', [], Infinity ]
 *  [ 'write', [ 'read' ], 1 ]
 * ] );
 * 
 * await states.acquire( 'read' );
 * await states.acquire( 'write' );
 * 
 * @export
 * @class StateSemaphore
 */
export class StateSemaphore {
    lanes : Map<string, StateLaneSemaphore>;

    constructor ( lanes : [ string, string[], number ][] = [] ) {
        this.lanes = new Map();

        for ( let [ lane, blocks, count ] of lanes ) {
            this.createLane( lane, blocks, count );
        }
    }

    createLane ( name : string, blocks : string[], count : number = Infinity ) {
        const lane = new StateLaneSemaphore( this, name, blocks, count );
        
        this.lanes.set( name, lane );

        return lane;
    }

    getLane ( name : string ) : StateLaneSemaphore {
        if ( !this.lanes.has( name ) ) {
            this.lanes.set( name, new StateLaneSemaphore( this, name, [], Infinity ) );
        }

        return this.lanes.get( name );
    }

    async acquire ( laneName : string ) {
        const lane = this.getLane( laneName );

        return lane.acquire();
    }

    release ( laneName : string ) {
        const lane = this.getLane( laneName );
        
        return lane.release();
    }

    async use<T> ( laneName : string, fn : () => Promise<T> ) : Promise<T> {
        const lane = this.getLane( laneName );
        
        return lane.use( fn );
    }
}

export class ReadWriteSemaphore {
    protected states : StateSemaphore;

    constructor ( readCount : number = Infinity ) {
        this.states = new StateSemaphore( [
            [ 'read', [], readCount ],
            [ 'write', [ 'read' ], 1 ]
        ] );
    }

    get read () : SemaphoreLike {
        return this.states.getLane( 'read' );
    }

    get write () : SemaphoreLike {
        return this.states.getLane( 'write' );
    }
}
