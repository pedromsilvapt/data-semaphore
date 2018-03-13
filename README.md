# Semaphore

> Lightweight TypeScript/ES2017 class to simulate an asynchonous semaphore, with several utility functions

# Installation
```shell
npm install --save data-semaphore
```

# Usage
```typescript
import { Semaphore } from 'data-semaphore';

const semaphore = new Semaphore( 1 );

const main = async () => {
    const release = await semaphore.acquire();

    try {
        // Critical code we want to limit the concurrency of
        // ...
    } finally {
        // Put the release in the fianlly block, so that it always runs
        // Despite of possible uncaught exceptions or early return statements
        // Not doing so may result in deadblocks
        release();
    }
};

// Calling the main function multiple times will result in each subsequent call being delayed until the last one has finished,
// Effectively the same as running them sequentially
main();
```

For this particular use case, where the max concurrent count is one, we can use the shorthand `let semaphore = new Mutex();`
Using a semaphore with a count bigger than one allows to limit the concurrency, that is, the ammount of code protected by that
semaphore that can be executed at the same time. Any further calls of execute the same code will wait until a vacancy is available.

We can also create a semaphore for each object. This allows a more finegrained control when each object should have their own semaphore.

```typescript
class HeavyUserTasks {
    private semaphore : SemaphorePool<User> = new SemaphoreUser<Pool>( 3 );

    async run ( user : User ) : Promise<T> {
        const release = await this.semaphore.acquire( user );

        try {
            // This way each user can only execute three tasks at the same time
            // ...
        } finally {
            release();
        }
    }
}
```

Also, a simple way to convert a whole class method is to use the `Synchronized` decorator.

```typescript
class HeavyUserTasks {
    // If the count is omitted, the default value will be 1
    // If no getter is provided, a single Semaphore will be used for all calls instead of a SemaphorePool 
    @Synchronized( 3, user => user )
    async run () : Promise<T> {
        // This way each user can only execute three tasks at the same time
        // ...
    }
}
```