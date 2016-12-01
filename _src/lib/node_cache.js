// lodash requires
const assignIn   = require( "lodash/assignIn");
const isArray    = require( "lodash/isArray");
const isString   = require( "lodash/isString");
const isFunction = require( "lodash/isFunction");
const isNumber   = require( "lodash/isNumber");
const isObject   = require( "lodash/isObject");
const size       = require( "lodash/size");
const template   = require( "lodash/template");

const clone = require("clone");
const EventEmitter = require('events').EventEmitter;

// generate superclass
class NodeCache extends EventEmitter {
	constructor( options = {} ){
        super();

        this._ERRORS = {
            "ENOTFOUND": "Key `<%= key %>` not found",
            "EKEYTYPE": "The key argument has to be of type `string` or `number`. Found: `<%= type %>`",
            "EKEYSTYPE": "The keys argument has to be an array."
        };

		this._initErrors();
		// container for cached data
		this.data = {};

		// module options
		this.options = Object.assign({
			// convert all elements to string
			forceString: false,
			// used standard size for calculating value size
			objectValueSize: 80,
			arrayValueSize: 40,
			// standard time to live in seconds. 0 = infinity;
			stdTTL: 0,
			// time in seconds to check all data and delete expired keys
			checkperiod: 600,
			// en/disable cloning of variables. If `true` you'll get a copy of the cached variable. If `false` you'll save and get just the reference
			useClones: true,
			// en/disable throwing errors when trying to `.get` missing or expired values.
			errorOnMissing: false,


		}, options)

		// statistics container
		this.stats = {
			hits: 0,
			misses: 0,
			keys: 0,
			ksize: 0,
			vsize: 0
		};

		// pre allocate valid keytypes array
		this.validKeyTypes = ["string", "number"];

		// initalize checking period
		this._checkData();
	}

	// ## get
	//
	// get a cached key and change the stats
	//
	// **Parameters:**
	//
	// * `key` ( String | Number ): cache key
	// * `[cb]` ( Function ): Callback function
	// * `[errorOnMissing=false]` ( Boolean ) return a error to the `cb` or throw it if no `cb` is used. Otherwise the get will return `undefined` on a miss.
	//
	// **Example:**
	//
	//     myCache.get "myKey", ( err, val )->
	//       console.log( err, val )
	//       return
	//
	get( key, cb, errorOnMissing ){
		// handle passing in errorOnMissing without cb
		let err;
		if (typeof cb === "boolean" && arguments.length === 2) {
			errorOnMissing = cb;
			cb = undefined;
		}

		// handle invalid key types
		if ((err = this._isInvalidKey( key )) != null) {
			if (cb != null) {
				cb( err );
				return;
			} else {
				throw err;
			}
		}

		// get data and incremet stats
		if ((this.data[ key ] != null) && this._check( key, this.data[ key ] )) {
			this.stats.hits++;
			let _ret = this._unwrap( this.data[ key ] );
			// return data
			if (cb != null) { cb( null, _ret ); }
			return _ret;
		} else {
			// if not found return a error
			this.stats.misses++;
			if (this.options.errorOnMissing || errorOnMissing) {
				let _err = this._error( "ENOTFOUND", { key }, cb );
				if (_err != null) {
					throw _err;
				}
				return;
			} else {
				if (cb != null) { cb( null, undefined ); }
			}
			return undefined;
		}
	}


	// ## mget
	//
	// get multiple cached keys at once and change the stats
	//
	// **Parameters:**
	//
	// * `keys` ( String|Number[] ): an array of keys
	// * `[cb]` ( Function ): Callback function
	//
	// **Example:**
	//
	//     myCache.mget [ "foo", "bar" ], ( err, val )->
	//       console.log( err, val )
	//       return
	//
	mget( keys, cb ){
		// convert a string to an array of one key
		if (!isArray( keys )) {
			let _err = this._error( "EKEYSTYPE" );
			if (cb != null) { cb( _err ); }
			return _err;
		}

		// define return
		let oRet = {};
		for (let key of keys) {
			// handle invalid key types
			let err;
			if ((err = this._isInvalidKey( key )) != null) {
				if (cb != null) {
					cb( err );
					return;
				} else {
					throw err;
				}
			}

			// get data and increment stats
			if ((this.data[ key ] != null) && this._check( key, this.data[ key ] )) {
				this.stats.hits++;
				oRet[ key ] = this._unwrap( this.data[ key ] );
			} else {
				// if not found return a error
				this.stats.misses++;
			}
		}

		// return all found keys
		if (cb != null) { cb( null, oRet ); }
		return oRet;
	}

	// ## set
	//
	// set a cached key and change the stats
	//
	// **Parameters:**
	//
	// * `key` ( String | Number ): cache key
	// * `value` ( Any ): A element to cache. If the option `option.forceString` is `true` the module trys to translate it to a serialized JSON
	// * `[ ttl ]` ( Number | String ): ( optional ) The time to live in seconds.
	// * `[cb]` ( Function ): Callback function
	//
	// **Example:**
	//
	//     myCache.set "myKey", "my_String Value", ( err, success )->
	//       console.log( err, success )
	//
	//     myCache.set "myKey", "my_String Value", "10", ( err, success )->
	//       console.log( err, success )
	//
	set( key, value, ttl, cb ){
		// force the data to string
		let err;
		if (this.options.forceString && !isString( value )) {
			value = JSON.stringify( value );
		}

		// remap the arguments if `ttl` is not passed
		if (arguments.length === 3 && isFunction( ttl )) {
			cb = ttl;
			ttl = this.options.stdTTL;
		}

		// handle invalid key types
		if ((err = this._isInvalidKey( key )) != null) {
			if (cb != null) {
				cb( err );
				return;
			} else {
				throw err;
			}
		}

		// internal helper variables
		let existent = false;

		// remove existing data from stats
		if (this.data[ key ]) {
			existent = true;
			this.stats.vsize -= this._getValLength( this._unwrap( this.data[ key ], false ) );
		}

		// set the value
		this.data[ key ] = this._wrap( value, ttl );
		this.stats.vsize += this._getValLength( value );

		// only add the keys and key-size if the key is new
		if (!existent) {
			this.stats.ksize += this._getKeyLength( key );
			this.stats.keys++;
		}

		this.emit( "set", key, value );

		// return true
		if (cb != null) { cb( null, true ); }
		return true;
	}

	// ## del
	//
	// remove keys
	//
	// **Parameters:**
	//
	// * `keys` ( String | Number | String|Number[] ): cache key to delete or a array of cache keys
	// * `[cb]` ( Function ): Callback function
	//
	// **Return**
	//
	// ( Number ): Number of deleted keys
	//
	// **Example:**
	//
	//     myCache.del( "myKey" )
	//
	//     myCache.del( "myKey", ( err, delCount )->
	//       console.log( err, delCount )
	//       return
	del( keys, cb ){
		// convert keys to an array of itself
		if (!isArray( keys )) {
			keys = [ keys ];
		}

		let delCount = 0;
		for (let key of keys) {
			// handle invalid key types
			let err;
			if ((err = this._isInvalidKey( key )) != null) {
				if (cb != null) {
					cb( err );
					return;
				} else {
					throw err;
				}
			}
			// only delete if existent
			if (this.data[ key ] != null) {
				// calc the stats
				this.stats.vsize -= this._getValLength( this._unwrap( this.data[ key ], false ) );
				this.stats.ksize -= this._getKeyLength( key );
				this.stats.keys--;
				delCount++;
				// delete the value
				let oldVal = this.data[ key ];
				delete this.data[ key ];
				// return true
				this.emit( "del", key, oldVal.v );
			} else {
				// if the key has not been found return an error
				this.stats.misses++;
			}
		}


		if (cb != null) { cb( null, delCount ); }
		return delCount;
	}

	// ## ttl
	//
	// reset or redefine the ttl of a key. `ttl` = 0 means inifite lifetime.
	// If `ttl` is not passed the default ttl is used.
	// If `ttl` < 0 the key will be deleted.
	//
	// **Parameters:**
	//
	// * `key` ( String | Number ): cache key to reset the ttl value
	// * `ttl` ( Number ): ( optional -> options.stdTTL || 0 ) The time to live in seconds
	// * `[cb]` ( Function ): Callback function
	//
	// **Return**
	//
	// ( Boolen ): key found and ttl set
	//
	// **Example:**
	//
	//     myCache.ttl( "myKey" ) // will set ttl to default ttl
	//
	//     myCache.ttl( "myKey", 1000, ( err, keyFound )->
	//       console.log( err, success )
	//
	ttl() {
		// change args if only key and callback are passed
		let key;
		let err;
        let ttl;
        let cb;

        for(let i = 0; i < arguments.length; i++) {
            const arg = arguments[i];

            if (!i) {
                key = arg;
                continue;
            }

            switch (typeof arg) {
                case "number":   ttl = arg; break;
                case "function": cb = arg;  break;
            }
        }


		if (!ttl) { ttl = this.options.stdTTL; }
		if (!key) {
			if (cb != null) { cb( null, false ); }
			return false;
		}

		// handle invalid key types
		if ((err = this._isInvalidKey( key )) != null) {
			if (cb != null) {
				cb( err );
				return;
			} else {
				throw err;
			}
		}

		// check for existent data and update the ttl value
		if ((this.data[ key ] != null) && this._check( key, this.data[ key ] )) {
			// if ttl < 0  delete the key. otherwise reset the value
			if (ttl >= 0) {
				this.data[ key ] = this._wrap( this.data[ key ].v, ttl, false );
			} else {
				this.del( key );
			}
			if (cb != null) { cb( null, true ); }
			return true;
		} else {
			// return false if key has not been found
			if (cb != null) { cb( null, false ); }
			return false;
		}

	}

	// ## getTtl
	//
	// receive the ttl of a key.
	//
	// **Parameters:**
	//
	// * `key` ( String | Number ): cache key to check the ttl value
	// * `[cb]` ( Function ): Callback function
	//
	// **Return**
	//
	// ( Number|undefined ): The timestamp in ms when the key will expire, 0 if it will never expire or undefined if it not exists
	//
	// **Example:**
	//
	//     ts = myCache.getTtl( "myKey" )
	//
	//     myCache.getTtl( "myKey",( err, ttl )->
	//       console.log( err, ttl )
	//       return
	//
	getTtl( key, cb ){
		let err;
		if (!key) {
			if (cb != null) { cb( null, undefined ); }
			return undefined;
		}

		// handle invalid key types
		if ((err = this._isInvalidKey( key )) != null) {
			if (cb != null) {
				cb( err );
				return;
			} else {
				throw err;
			}
		}

		// check for existent data and update the ttl value
		if ((this.data[ key ] != null) && this._check( key, this.data[ key ] )) {
			let _ttl = this.data[ key ].t;
			if (cb != null) { cb( null, _ttl ); }
			return _ttl;
		} else {
			// return undefined if key has not been found
			if (cb != null) { cb( null, undefined ); }
			return undefined;
		}

	}

	// ## keys
	//
	// list all keys within this cache
	//
	// **Parameters:**
	//
	// * `[cb]` ( Function ): Callback function
	//
	// **Return**
	//
	// ( Array ): An array of all keys
	//
	// **Example:**
	//
	//     _keys = myCache.keys()
	//
	//     # [ "foo", "bar", "fizz", "buzz", "anotherKeys" ]
	//
	keys( cb ){
		let _keys = Object.keys( this.data );
		if (cb != null) { cb( null, _keys ); }
		return _keys;
	}

	// ## getStats
	//
	// get the stats
	//
	// **Parameters:**
	//
	// -
	//
	// **Return**
	//
	// ( Object ): Stats data
	//
	// **Example:**
	//
	//     myCache.getStats()
	//     # {
	//     # hits: 0,
	//     # misses: 0,
	//     # keys: 0,
	//     # ksize: 0,
	//     # vsize: 0
	//     # }
	//
	getStats() {
		return this.stats;
	}

	// ## flushAll
	//
	// flush the hole data and reset the stats
	//
	// **Example:**
	//
	//     myCache.flushAll()
	//
	//     myCache.getStats()
	//     # {
	//     # hits: 0,
	//     # misses: 0,
	//     # keys: 0,
	//     # ksize: 0,
	//     # vsize: 0
	//     # }
	//
	flushAll( _startPeriod = true ){
		// parameter just for testing

		// set data empty
		this.data = {};

		// reset stats
		this.stats = {
			hits: 0,
			misses: 0,
			keys: 0,
			ksize: 0,
			vsize: 0
		};

		// reset check period
		this._killCheckPeriod();
		this._checkData( _startPeriod );

		this.emit( "flush" );

	}

	// ## close
	//
	// This will clear the interval timeout which is set on checkperiod option.
	//
	// **Example:**
	//
	//     myCache.close()
	//
	close() {
		this._killCheckPeriod();
	}

	// ## _checkData
	//
	// internal Housekeeping mehtod.
	// Check all the cached data and delete the invalid values
	_checkData( startPeriod = true ){
		// run the housekeeping method
		for (let key in this.data) {
			let value = this.data[key];
			this._check( key, value );
		}

		if (startPeriod && this.options.checkperiod > 0) {
			this.checkTimeout = setTimeout( this._checkData, ( this.options.checkperiod * 1000 ) );
			if (this.checkTimeout.unref != null) { this.checkTimeout.unref(); }
		}
	}

	// ## _killCheckPeriod
	//
	// stop the checkdata period. Only needed to abort the script in testing mode.
	_killCheckPeriod() {
		if (this.checkTimeout != null) { return clearTimeout( this.checkTimeout ); }
	}

	// ## _check
	//
	// internal method the check the value. If it's not valid any moe delete it
	_check( key, data ){
		// data is invalid if the ttl is to old and is not 0
		//console.log data.t < Date.now(), data.t, Date.now()
		if (data.t !== 0 && data.t < Date.now()) {
			this.del( key );
			this.emit( "expired", key, this._unwrap(data) );
			return false;
		} else {
			return true;
		}
	}

	// ## _isInvalidKey
	//
	// internal method to check if the type of a key is either `number` or `string`
	_isInvalidKey( key ){
		if (!this.validKeyTypes.includes(typeof key)) {
			return this._error( "EKEYTYPE", { type: typeof key });
		}
	}


	// ## _wrap
	//
	// internal method to wrap a value in an object with some metadata
	_wrap( value, ttl, asClone = true ){
		let oReturn;
		if (!this.options.useClones) {
			asClone = false;
		}
		// define the time to live
		let now = Date.now();
		let livetime = 0;

		let ttlMultiplicator = 1000;

		// use given ttl
		if (ttl === 0) {
			livetime = 0;
		} else if (ttl) {
			livetime = now + ( ttl * ttlMultiplicator );
		} else {
			// use standard ttl
			if (this.options.stdTTL === 0) {
				livetime = this.options.stdTTL;
			} else {
				livetime = now + ( this.options.stdTTL * ttlMultiplicator );
			}
		}

		// return the wrapped value
		return oReturn = {
			t: livetime,
			v: asClone ? clone( value ) : value
		};
	}

	// ## _unwrap
	//
	// internal method to extract get the value out of the wrapped value
	_unwrap( value, asClone = true ){
		if (!this.options.useClones) {
			asClone = false;
		}
		if (value.v != null) {
			if (asClone) {
				return clone( value.v );
			} else {
				return value.v;
			}
		}
		return null;
	}

	// ## _getKeyLength
	//
	// internal method the calculate the key length
	_getKeyLength( key ){
		return key.length;
	}

	// ## _getValLength
	//
	// internal method to calculate the value length
	_getValLength( value ){
		if (isString( value )) {
			// if the value is a String get the real length
			return value.length;
		} else if (this.options.forceString) {
			// force string if it's defined and not passed
			return JSON.stringify( value ).length;
		} else if (isArray( value )) {
			// if the data is an Array multiply each element with a defined default length
			return this.options.arrayValueSize * value.length;
		} else if (isNumber( value )) {
			return 8;
		} else if (isObject( value )) {
			// if the data is an Object multiply each element with a defined default length
			return this.options.objectValueSize * size( value );
		} else {
			// default fallback
			return 0;
		}
	}

	// ## _error
	//
	// internal method to handle an error message
	_error( type, data = {}, cb ){
		// generate the error object
		let error = new Error();
		error.name = type;
		error.errorcode = type;
		error.message = (this.ERRORS[ type ] != null) ? this.ERRORS[ type ]( data ) : "-";
		error.data = data;

		if (cb && isFunction( cb )) {
			// return the error
			cb( error, null );
			return;
		} else {
			// if no callback is defined return the error object
			return error;
		}
	}

	// ## _initErrors
	//
	// internal method to generate error message templates
	_initErrors() {
		this.ERRORS = {};
		for (let _errT in this._ERRORS) {
			let _errMsg = this._ERRORS[_errT];
			this.ERRORS[ _errT ] = template( _errMsg );
		}

	}
};

module.exports = NodeCache;
