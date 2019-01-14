/*
    This file is part of web3.js.

    web3.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    web3.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with web3.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/**
 * @file template.js
 * @author Marek Kotewicz <marek@ethdev.com>
 * @date 2014
 */

var utils = require('../utils/utils');
var coder = require('../solidity/coder');
var SolidityEvent = require('./event');
var SolidityFunction = require('./function');
var AllEvents = require('./allevents');

/**
 * Should be called to encode constructor params
 *
 * @method encodeConstructorParams
 * @param {Array} abi
 * @param {Array} constructor params
 */
var encodeConstructorParams = function (abi, params) {
    return abi.filter(function (json) {
        return json.type === 'constructor' && json.inputs.length === params.length;
    }).map(function (json) {
        return json.inputs.map(function (input) {
            return input.type;
        });
    }).map(function (types) {
        return coder.encodeParams(types, params);
    })[0] || '';
};

/**
 * Should be called to add functions to template object
 *
 * @method addFunctionsToTemplate
 * @param {Template} template
 * @param {Array} abi
 */
var addFunctionsToTemplate = function (template) {
    template.abi.filter(function (json) {
        return json.type === 'function';
    }).map(function (json) {
        return new SolidityFunction(template._eth, json, template.address);
    }).forEach(function (f) {
        f.attachToContract(template);
    });
};

/**
 * Should be called to add events to template object
 *
 * @method addEventsToTemplate
 * @param {Template} template
 * @param {Array} abi
 */
var addEventsToTemplate = function (template) {
    var events = template.abi.filter(function (json) {
        return json.type === 'event';
    });

    var All = new AllEvents(template._eth._requestManager, events, template.address);
    All.attachToTemplate(template);

    events.map(function (json) {
        return new SolidityEvent(template._eth._requestManager, json, template.address);
    }).forEach(function (e) {
        e.attachToTemplate(template);
    });
};


/**
 * Should be called to check if the template gets properly deployed on the blockchain.
 *
 * @method checkForTemplateAddress
 * @param {Object} template
 * @param {Function} callback
 * @returns {Undefined}
 */
var checkForTemplateAddress = function(template, callback){
    var count = 0,
        callbackFired = false;

    // wait for receipt
    var filter = template._eth.filter('latest', function(e){
        if (!e && !callbackFired) {
            count++;

            // stop watching after 50 blocks (timeout)
            if (count > 50) {

                filter.stopWatching(function() {});
                callbackFired = true;

                if (callback)
                    callback(new Error('Template transaction couldn\'t be found after 50 blocks'));
                else
                    throw new Error('Template transaction couldn\'t be found after 50 blocks');


            } else {

                template._eth.getTransactionReceipt(template.transactionHash, function(e, receipt){
                    if(receipt && receipt.blockHash && !callbackFired) {

                        template._eth.getCode(receipt.templateAddress, function(e, code){
                            /*jshint maxcomplexity: 6 */

                            if(callbackFired || !code)
                                return;

                            filter.stopWatching(function() {});
                            callbackFired = true;

                            if(code.length > 3) {

                                // console.log('Template code deployed!');

                                template.address = receipt.templateAddress;

                                // attach events and methods again after we have
                                addFunctionsToTemplate(template);
                                addEventsToTemplate(template);

                                // call callback for the second time
                                if(callback)
                                    callback(null, template);

                            } else {
                                if(callback)
                                    callback(new Error('The template code couldn\'t be stored, please check your gas amount.'));
                                else
                                    throw new Error('The template code couldn\'t be stored, please check your gas amount.');
                            }
                        });
                    }
                });
            }
        }
    });
};

/**
 * Should be called to create new TemplateFactory instance
 *
 * @method TemplateFactory
 * @param {Array} abi
 */
var TemplateFactory = function (eth, abi) {
    this.eth = eth;
    this.abi = abi;

    /**
     * Should be called to create new template on a blockchain
     *
     * @method new
     * @param {Any} template constructor param1 (optional)
     * @param {Any} template constructor param2 (optional)
     * @param {Object} template transaction object (required)
     * @param {Function} callback
     * @returns {Template} returns template instance
     */
    this.new = function () {
        /*jshint maxcomplexity: 7 */

        var template = new Template(this.eth, this.abi);

        // parse arguments
        var options = {}; // required!
        var callback;

        var args = Array.prototype.slice.call(arguments);
        if (utils.isFunction(args[args.length - 1])) {
            callback = args.pop();
        }

        var last = args[args.length - 1];
        if (utils.isObject(last) && !utils.isArray(last)) {
            options = args.pop();
        }

        if (options.value > 0) {
            var constructorAbi = abi.filter(function (json) {
                return json.type === 'constructor' && json.inputs.length === args.length;
            })[0] || {};

            if (!constructorAbi.payable) {
                throw new Error('Cannot send value to non-payable constructor');
            }
        }

        var bytes = encodeConstructorParams(this.abi, args);
        options.data += bytes;

        if (callback) {

            // wait for the template address and check if the code was deployed
            this.eth.sendTransaction(options, function (err, hash) {
                if (err) {
                    callback(err);
                } else {
                    // add the transaction hash
                    template.transactionHash = hash;

                    // call callback for the first time
                    callback(null, template);

                    checkForTemplateAddress(Template, callback);
                }
            });
        } else {
            var hash = this.eth.sendTransaction(options);
            // add the transaction hash
            Template.transactionHash = hash;
            checkForTemplateAddress(template);
        }

        return template;
    };

    this.new.getData = this.getData.bind(this);
    this.initParameters = this.initParameters.bind(this);
};

/**
 * Should be called to get access to existing template on a blockchain
 *
 * @method at
 * @param {Address} template address (required)
 * @param {Function} callback {optional)
 * @returns {Template} returns template if no callback was passed,
 * otherwise calls callback function (err, template)
 */
TemplateFactory.prototype.at = function (address, callback) {
    var template = new Template(this.eth, this.abi, address);

    // this functions are not part of prototype,
    // because we dont want to spoil the interface
    addFunctionsToTemplate(template);
    addEventsToTemplate(template);

    if (callback) {
        callback(null, template);
    }
    return template;
};

/**
 * Gets the data, which is data to deploy plus constructor params
 *
 * @method getData
 */
TemplateFactory.prototype.getData = function () {
    var options = {}; // required!
    var args = Array.prototype.slice.call(arguments);

    var last = args[args.length - 1];
    if (utils.isObject(last) && !utils.isArray(last)) {
        options = args.pop();
    }

    var bytes = encodeConstructorParams(this.abi, args);
    options.data += bytes;

    return options.data;
};

TemplateFactory.prototype.initParameters = function (types, parameters) {
    if(!types || !parameters){
        return 'Parameters or types is null'
    }
    var detail = null;
    this.abi.filter(function (item) { // 遍历abi
        if(item.type === 'constructor'){ // 判定构造函数
            item.inputs.forEach(function (item,i) { // 遍历构造函数的输入参数
                if(item.type !== types[i]){ // 判断abi输入类型与输入的类型是否正确
                    detail = 'Type is error : abi[' + item.type + '] does not match types[' +types[i] +']';
                    return
                }
                if(!isTypeOf(item.type,parameters[i])){
                    detail = 'Parameter is error : abi[' + item.type + '] does not match parameters[' + parameters[i]+']';
                    return
                }
            })
        }
    })
    if(detail){
        return detail
    }
    var options = {}; // required!
    var args = Array.prototype.slice.call(parameters);
    var last = args[args.length - 1];
    if (utils.isObject(last) && !utils.isArray(last)) {
        options = args.pop();
    }
    return encodeConstructorParams(this.abi, args); // 生成参数的 bytecode
};

/**
 * Should be called to create new template instance
 *
 * @method Template
 * @param {Array} abi
 * @param {Address} Template address
 */
var Template = function (eth, abi, address) {
    this._eth = eth;
    this.transactionHash = null;
    this.address = address;
    this.abi = abi;
};

/**
 * 判断传入的参数是否与abi的类型相同；
 * @param abiType 比较的abi类型
 * @param parameter 需要比较的参数
 * @return boolean true 匹配； false 不匹配
 **/
function isTypeOf(abiType,parameter) {
    if(!abiType || !parameter){
        return false
    }
    abiType = abiType.toLowerCase();
    var obj = abiType.indexOf('[') < 0 ? null : 'object';
    if(obj == null){
        obj = (abiType.indexOf('address') < 0 && abiType.indexOf('string')< 0) ? null : 'string'
    }
    if(obj == null){
        obj = abiType.indexOf('int') < 0 ?  null : 'number'
    }
    if(obj == null){
        obj = abiType.indexOf('bool') < 0 ? null : 'boolean'
    }
    if(obj == null){ // 未知的参数类型直接 true
        return true
    }
    var parameterType = typeof (parameter);
    if(parameterType === obj){
        return true
    }
    return false
}

module.exports = TemplateFactory;
