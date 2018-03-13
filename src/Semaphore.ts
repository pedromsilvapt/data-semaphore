export interface SemahporeQueue<T> {
    reject ( reason : any ) : void;

    resolve ( value : T | PromiseLike<T> ) : void;

    released : boolean;
}

export interface SemaphoreRelease {
    () : void;
}

export class Semaphore {
    protected queue : SemahporeQueue<SemaphoreRelease>[];

    public count : number;

    constructor ( count : number ) {
        this.count = count;
    }

    acquire () : Promise<SemaphoreRelease> {
        this.count--;

        if ( this.count >= 0 ) {
            return Promise.resolve( this.release.bind( this ) );
        }

        const index = this.queue.length;

        this.queue.push( null );

        return new Promise<SemaphoreRelease>( ( resolve, reject ) => {
            this.queue[ index ] = { resolve, reject, released: false };
        } );
    }

    release () : void {
        let canIncrease : boolean = true;
        let canCleanup : boolean = true;
        let releasedCount : number = 0;
        
        for ( let [ index, item ] of this.queue.entries() ) {
            if ( item == null ) {
                canCleanup = false;

                continue;
            }

            if ( item.released ) {
                if ( canCleanup ) {
                    releasedCount++;
                }

                continue;
            }

            item.released = true;

            item.resolve( this.release.bind( this ) );

            canIncrease = false;

            if ( canCleanup ) {
                releasedCount++;
            }

            break;
        }

        if ( releasedCount > 0 ) {
            this.queue.splice( 0, releasedCount );
        }

        if ( canIncrease ) {
            this.count++;
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

    async acquire ( object : T ) : Promise<SemaphoreRelease> {
        let semaphore = this.semaphores.get( object );

        if ( !semaphore ) {
            semaphore = new Semaphore( this.count );

            this.semaphores.set( object, semaphore );
        }

        await semaphore.acquire();

        return this.release.bind( this.release, object );
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
        return (target: Object, key: string | symbol, descriptor: TypedPropertyDescriptor<Function>) => {
            let semaphoreMap : SemaphorePool<T> = new SemaphorePool( count );

            return {
                value: function ( ...args : any[] ) {
                    const object = getter.apply( this, args );

                    return semaphoreMap.use( object, () => descriptor.value.apply( target, args ) );
                }
            };
        };
    } else {
        return (target: Object, key: string | symbol, descriptor: TypedPropertyDescriptor<Function>) => {
            let semaphore = new Semaphore( count );

            return {
                value: function( ... args: any[]) {
                    return semaphore.use( () => descriptor.value.apply( target, args ) );
                }
            };
        };
    }
}