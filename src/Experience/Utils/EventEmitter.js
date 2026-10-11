/**
 * Minimal event system (on / off / trigger) with namespaces.
 * Taken from "Code structuring for bigger projects" (Bruno Simon), with an
 * extra guard in trigger() for unknown events inside a namespace.
 */
export default class EventEmitter
{
    constructor()
    {
        this.callbacks = {}
        this.callbacks.base = {}
    }

    on(_names, callback)
    {
        if(typeof _names === 'undefined' || _names === '')
        {
            console.warn('wrong names')
            return false
        }

        if(typeof callback === 'undefined')
        {
            console.warn('wrong callback')
            return false
        }

        const names = this.resolveNames(_names)

        names.forEach((_name) =>
        {
            const name = this.resolveName(_name)

            if(!(this.callbacks[ name.namespace ] instanceof Object))
                this.callbacks[ name.namespace ] = {}

            if(!(this.callbacks[ name.namespace ][ name.value ] instanceof Array))
                this.callbacks[ name.namespace ][ name.value ] = []

            this.callbacks[ name.namespace ][ name.value ].push(callback)
        })

        return this
    }

    off(_names)
    {
        if(typeof _names === 'undefined' || _names === '')
        {
            console.warn('wrong name')
            return false
        }

        const names = this.resolveNames(_names)

        names.forEach((_name) =>
        {
            const name = this.resolveName(_name)

            // Remove namespace
            if(name.namespace !== 'base' && name.value === '')
            {
                delete this.callbacks[ name.namespace ]
            }

            // Remove specific callback in namespace
            else
            {
                // Default
                if(name.namespace === 'base')
                {
                    // Try to remove from each namespace
                    for(const namespace in this.callbacks)
                    {
                        if(this.callbacks[ namespace ] instanceof Object && this.callbacks[ namespace ][ name.value ] instanceof Array)
                        {
                            delete this.callbacks[ namespace ][ name.value ]

                            // Remove namespace if empty
                            if(Object.keys(this.callbacks[ namespace ]).length === 0)
                                delete this.callbacks[ namespace ]
                        }
                    }
                }

                // Specified namespace
                else if(this.callbacks[ name.namespace ] instanceof Object && this.callbacks[ name.namespace ][ name.value ] instanceof Array)
                {
                    delete this.callbacks[ name.namespace ][ name.value ]

                    // Remove namespace if empty
                    if(Object.keys(this.callbacks[ name.namespace ]).length === 0)
                        delete this.callbacks[ name.namespace ]
                }
            }
        })

        return this
    }

    trigger(_name, _args)
    {
        if(typeof _name === 'undefined' || _name === '')
        {
            console.warn('wrong name')
            return false
        }

        let finalResult = null
        let result = null

        // Default args
        const args = !(_args instanceof Array) ? [] : _args

        // Resolve names (should only have one event)
        let name = this.resolveNames(_name)

        // Resolve name
        name = this.resolveName(name[ 0 ])

        // Default namespace
        if(name.namespace === 'base')
        {
            // Try to find callback in each namespace
            for(const namespace in this.callbacks)
            {
                if(this.callbacks[ namespace ] instanceof Object && this.callbacks[ namespace ][ name.value ] instanceof Array)
                {
                    this.callbacks[ namespace ][ name.value ].forEach(function(callback)
                    {
                        result = callback.apply(this, args)

                        if(typeof finalResult === 'undefined')
                        {
                            finalResult = result
                        }
                    })
                }
            }
        }

        // Specified namespace
        else if(this.callbacks[ name.namespace ] instanceof Object)
        {
            if(name.value === '' || !(this.callbacks[ name.namespace ][ name.value ] instanceof Array))
            {
                console.warn('wrong name')
                return this
            }

            this.callbacks[ name.namespace ][ name.value ].forEach(function(callback)
            {
                result = callback.apply(this, args)

                if(typeof finalResult === 'undefined')
                    finalResult = result
            })
        }

        return finalResult
    }

    resolveNames(_names)
    {
        let names = _names
        names = names.replace(/[^a-zA-Z0-9 ,/.]/g, '')
        names = names.replace(/[,/]+/g, ' ')
        names = names.split(' ')

        return names
    }

    resolveName(name)
    {
        const newName = {}
        const parts = name.split('.')

        newName.original = name
        newName.value = parts[ 0 ]
        newName.namespace = 'base' // Base namespace

        // Specified namespace
        if(parts.length > 1 && parts[ 1 ] !== '')
        {
            newName.namespace = parts[ 1 ]
        }

        return newName
    }
}
