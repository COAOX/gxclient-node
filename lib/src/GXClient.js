import { Aes, key, object_id_type, PrivateKey, PublicKey, string_to_name, TransactionHelper } from "gxbjs/dist/index";
import { serializeCallData } from "gxbjs/dist/tx_serializer";
import TransactionBuilder from "./TransactionBuilder";
import {generateMnemonic} from "./util/memonic";
import uniq from "lodash/uniq";
import { DEFUALT_EXPIRE_SEC } from "../const/const";
import axios from "axios";
import GXRPC from "./GXRPC";

/**
 * This callback is displayed as a global member.
 * @callback signatureProvider
 * @param transaction {TransactionBuilder}
 * @param chain_id {String} - Chain Id
 */

/**
 * GXClient Class
 */
class GXClient {
    /**
     *
     * @param {String} private_key - private key
     * @param {String} account_id_or_name - e.g: '1.2.44'|'gxcaccount'
     * @param {String} entry_point - entry point network address
     * @param {signatureProvider} signProvider
     */
    constructor(private_key, account_id_or_name, entry_point = "wss://node1.gxb.io", signProvider = null) {
        this.private_key = private_key;
        this.account_id_or_name = account_id_or_name;
        if (/^1.2.\d+$/.test(account_id_or_name)) {
            this.account_id = account_id_or_name;
        } else {
            this.account = account_id_or_name;
        }
        this.connected = false;
        this.chain_id = "";
        this.witness = entry_point;
        this.signProvider = signProvider;
        this.host = this.witness.replace("wss://", "https://").replace("ws://", "http://");
        this.rpc = GXRPC.instance(this.host);
    }

    /**
     * generate key pair locally
     * @returns {{brainKey: *, privateKey: *, publicKey: *}}
     */
    generateKey(brainKey) {
        brainKey = brainKey || generateMnemonic(160); // generate a new brain key if not assigned
        console.log("bbk", brainKey);
        let privateKey = key.get_brainPrivateKey(brainKey);
        let publicKey = privateKey.toPublicKey().toPublicKeyString();
        return {
            brainKey,
            privateKey: privateKey.toWif(),
            publicKey
        };
    }

    /**
     * export public key from private key
     * @param privateKey {String}
     * @returns {String}
     */
    privateToPublic(privateKey) {
        return PrivateKey.fromWif(privateKey).toPublicKey().toPublicKeyString();
    }

    /**
     * check if public key is valid
     * @param publicKey {String}
     * @returns {boolean}
     */
    isValidPublic(publicKey) {
        return !!PublicKey.fromPublicKeyString(publicKey);
    }

    /**
     * check if private key is valid
     * @param privateKey {String}
     * @returns {boolean}
     */
    isValidPrivate(privateKey) {
        try {
            return !!PrivateKey.fromWif(privateKey);
        } catch (ex) {
            return false;
        }
    }

    /**
     * register an account by faucet
     * @param account {String} - Account name
     * @param activeKey {String} - Public Key for account operator
     * @param ownerKey {String} - Public Key for account owner
     * @param memoKey {String} - Public Key for memo
     * @param faucet {String} - faucet url
     * @returns {Promise<any>}
     * @example
     * curl ‘https://opengateway.gxb.io/account/register' -H 'Content-type: application/json' -H 'Accept: application/json’ -d ‘{“account”:{“name”:”gxb123”,”owner_key”:”GXC5wQ4RtjouyobBV57vTx7boBj4Kt3BUxZEMsUD3TU369d3C9DqZ”,”active_key”:”GXC7cPVyB9F1Pfiaaxw4nY3xKADo5993hEsTjFs294LKwhqsUrFZs”,”memo_key”:”GXC7cPVyB9F1Pfiaaxw4nY3xKADo5993hEsTjFs294LKwhqsUrFZs”,”refcode”:null,”referrer”:null}}’
     */
    register(account, activeKey, ownerKey, memoKey, faucet = "https://opengateway.gxb.io") {
        return new Promise((resolve, reject) => {
            if (!activeKey) {
                reject(new Error("active key is required"));
            } else {
                axios.post(`${faucet}/account/register`, {
                    account: {
                        name: account,
                        active_key: activeKey,
                        owner_key: ownerKey || activeKey,
                        memo_key: memoKey || activeKey
                    }
                }).then(resp => {
                    resolve(resp.data);
                }).catch(reject);
            }
        });
    }

    /**
     * fetching latest block each 3 seconds
     * @private
     */
    _latestBlockTask(force) {
        if (this.isTaskStarted && !force) {
            return false;
        }
        this.isTaskStarted = true;
        this.getDynamicGlobalProperties().then(obj => {
            try {
                let latestBlock = obj.last_irreversible_block_num;
                if (this.latestBlock !== latestBlock) {
                    this.latestBlock = latestBlock;
                    console.log("latest block:", this.latestBlock);
                }
            } catch (ex) {
                console.error("error when fetching block header,", ex);
            } finally {
                setTimeout(() => {
                    this._latestBlockTask(true);
                }, 3000);
            }
        });
    }

    /**
     * get object by id
     * @param object_id {String} - e.g: '1.2.3'
     * @returns {Request|PromiseLike<T>|Promise<T>}
     */
    getObject(object_id) {
        return this._query("get_objects", [[object_id]]).then(results => results[0]);
    }

    /**
     * get objects
     * @param {String[]} object_ids
     * @returns {Request|PromiseLike<T>|Promise<T>}
     */
    getObjects(object_ids) {
        return this._query("get_objects", [object_ids]);
    }

    /**
     * get account info by account name
     * @param account_name {String}
     * @returns {Promise<any>}
     */
    getAccount(account_name) {
        return this._query("get_account_by_name", [account_name]);
    }

    /**
     * get current blockchain id
     * @returns {Request|PromiseLike<T>|Promise<T>}
     */
    getChainID() {
        return this._query("get_chain_id", []);
    }

    /**
     * get dynamic global properties
     * @returns {Request|PromiseLike<T>|Promise<T>}
     */
    getDynamicGlobalProperties() {
        return this._query("get_dynamic_global_properties", []);
    }

    /**
     * get account_ids by public key
     * @param publicKey {String}
     * @returns {Request|PromiseLike<T>|Promise<T>}
     */
    getAccountByPublicKey(publicKey) {
        return this._query("get_key_references", [[publicKey]]).then(results => uniq(results[0]));
    }

    /**
     * get account balances by account name
     * @param account_name {String}
     * @returns {Promise<any>}
     */
    getAccountBalances(account_name) {
        return new Promise((resolve, reject) => {
            this.getAccount(account_name).then((account) => {
                resolve(this._query("get_account_balances", [account.id, []]));
            }).catch(reject);
        });
    }

    /**
     * get asset info by symbol
     * @param symbol {String} - e.g: 'GXC'
     * @returns {Promise<any>}
     */
    getAsset(symbol) {
        return this._query("lookup_asset_symbols", [[symbol]]).then(assets => assets[0]);
    }

    /**
     * get block by block height
     * @param blockHeight {Number} - block height
     * @returns {Promise<any>}
     */
    getBlock(blockHeight) {
        return this._query("get_block", [blockHeight]);
    }

    /**
     * detect new transactions related to this.account_id
     * @param blockHeight {Number} - block height
     * @param callback {Function}
     */
    detectTransaction(blockHeight, callback) {
        let detect = () => {
            this.getBlock(blockHeight).then(block => {
                console.log(blockHeight);
                if (block) {
                    block.transactions.forEach((transaction, i) => {
                        let txid = block.transaction_ids[i];
                        transaction.operations.forEach((op) => {
                            let exist = false;
                            for (var key in op[1]) {
                                let val = op[1][key];

                                if (val === this.account_id) {
                                    exist = true;
                                }
                            }
                            exist && callback && callback(blockHeight, txid, op);
                        });
                    });
                    if (blockHeight < this.latestBlock) {
                        process.nextTick(() => {
                            this.detectTransaction(blockHeight + 1, callback);
                        });
                    } else {
                        setTimeout(() => {
                            this.detectTransaction(blockHeight, callback);
                        }, 1000);
                    }
                } else {
                    setTimeout(() => {
                        this.detectTransaction(blockHeight, callback);
                    }, 1000);
                }
            }).catch(ex => {
                console.error("get block error", ex);
                setTimeout(() => {
                    this.detectTransaction(blockHeight, callback);
                }, 1000);
            });
        };
        this._latestBlockTask(false);
        detect();
    }

    /**
     * send transfer request to witness node
     * @param to {String} - to account name
     * @param memo {String|Function} - memo
     * @param amount_asset {String} - e.g: '1 GXC'
     * @param broadcast {Boolean}
     * @param options {Object}
     * @param options.fee_symbol {String} - e.g: 'GXC'
     * @returns {Promise<any>}
     */
    transfer(to, memo, amount_asset, broadcast = false, options = {}) {
        const fee_symbol = options.fee_symbol;
        let memo_private = this.private_key;
        let isMemoProvider = false;

        // if memo is function, it can receive fromAccount and toAccount, and should return a full memo object
        if (typeof memo === "function") {
            isMemoProvider = true;
        }

        return new Promise((resolve, reject) => {
            if (amount_asset.indexOf(" ") == -1) {
                reject(new Error("Incorrect format of asset, eg. \"100 GXC\""));
            } else {
                let amount = Number(amount_asset.split(" ").filter(o => !!o)[0]);
                let asset = amount_asset.split(" ").filter(o => !!o)[1];
                resolve(this._connect().then(() => {
                    const promises = [
                        this._query("get_objects", [[this.account_id]]),
                        this.getAccount(to),
                        this.getAsset(asset)
                    ];
                    if (fee_symbol) {
                        promises.push(this.getAsset(fee_symbol));
                    }

                    return Promise.all(promises).then(async results => {
                        let memo_object;
                        let fromAcc = results[0][0];
                        let toAcc = results[1];
                        let assetInfo = results[2];
                        let feeInfo = results[3] || {};
                        if (!toAcc) {
                            throw new Error(`Account ${to} not exist`);
                        }
                        if (!assetInfo) {
                            throw new Error(`Asset ${asset} not exist`);
                        }
                        amount = {
                            amount: this._accMult(amount, Math.pow(10, assetInfo.precision)),
                            asset_id: assetInfo.id
                        };

                        if (!isMemoProvider) {
                            let memo_from_public, memo_to_public;
                            if (memo) {
                                memo_from_public = fromAcc.options.memo_key;

                                // The 1s are base58 for all zeros (null)
                                if (/111111111111111111111/.test(memo_from_public)) {
                                    memo_from_public = null;
                                }

                                memo_to_public = toAcc.options.memo_key;
                                if (/111111111111111111111/.test(memo_to_public)) {
                                    memo_to_public = null;
                                }
                                let fromPrivate = PrivateKey.fromWif(memo_private);
                                if (memo_from_public != fromPrivate.toPublicKey().toPublicKeyString()) {
                                    throw new Error("memo signer not exist");
                                }
                            }

                            if (memo && memo_to_public && memo_from_public) {
                                let nonce = TransactionHelper.unique_nonce_uint64();
                                memo_object = {
                                    from: memo_from_public,
                                    to: memo_to_public,
                                    nonce,
                                    message: Aes.encrypt_with_checksum(
                                        PrivateKey.fromWif(memo_private),
                                        memo_to_public,
                                        nonce,
                                        new Buffer(memo, "utf-8")
                                    )
                                };
                            }
                        } else {
                            try {
                                memo_object = await memo(fromAcc, toAcc);
                            } catch (err) {
                                reject(err);
                                return;
                            }
                        }

                        let tr = this._createTransaction();

                        tr.add_operation(tr.get_type_operation("transfer", {
                            fee: {
                                amount: 0,
                                asset_id: feeInfo.id || amount.asset_id
                            },
                            from: fromAcc.id,
                            to: toAcc.id,
                            amount: amount,
                            memo: memo_object
                        }));
                        return this._processTransaction(tr, broadcast);
                    });
                }));
            }
        });
    }

    /**
     * get contract abi by contract_name
     * @param contract_name {String}
     * @returns {Promise<any>}
     */
    getContractABI(contract_name) {
        return this.getAccount(contract_name).then(acc => acc.abi);
    }

    /**
     * get contract table by contract_name
     * @param contract_name {String}
     * @returns {Promise<any>}
     */
    getContractTable(contract_name) {
        return this.getAccount(contract_name).then(acc => acc.abi && acc.abi.tables);
    }

    /**
     * fetch contract table record by contract_name and table_name
     * @param contract_name {String}
     * @param table_name {String}
     * @param start {Number}
     * @param limit {Number}
     * @returns {Promise<any>}
     */
    getTableObjects(contract_name, table_name, start = 0, limit = 100) {
        return this.getAccount(contract_name).then(acc => {
            if (acc) {
                let contract_id = object_id_type(acc.id).toString();
                return this._query("get_table_objects", [contract_id, contract_id, string_to_name(table_name).toString(), start, -1, limit]);
            } else {
                throw new Error("Contract not found");
            }
        });
    }

    /**
     * deploy smart contract
     * @param contract_name {String}
     * @param code {String} - bytecode
     * @param abi {Object} - abi object
     * @param vm_type {String}
     * @param vm_version {String}
     * @param broadcast {Boolean}
     * @param options {Object}
     * @param options.fee_symbol {String} - e.g: 'GXC'
     * @returns {Promise<any>}
     */
    async createContract(contract_name, code, abi, vm_type = "0", vm_version = "0", broadcast = false, options = {}) {
        const fee_symbol = options.fee_symbol;
        let feeInfo = {};
        if(fee_symbol){
            feeInfo = await this.getAsset(fee_symbol);
        }

        return this._connect().then(() => {
            let tr = this._createTransaction();
            tr.add_operation(tr.get_type_operation("create_contract", {
                fee: {
                    amount: 0,
                    asset_id: feeInfo.id || "1.3.1"
                },
                name: contract_name,
                account: this.account_id,
                vm_type,
                vm_version,
                code,
                abi
            }));
            return this._processTransaction(tr, broadcast);
        });
    }

    /**
     * update smart contract
     * @param contract_name {String}
     * @param newOwner {String} - new owner account name
     * @param code {String} - same to createContract
     * @param abi {Object} - same to createContract
     * @param broadcast {Boolean}
     * @param options {Object}
     * @param options.fee_symbol {String} - e.g: 'GXC'
     * @returns {Request|PromiseLike<T>|Promise<T>}
     */
    updateContract(contract_name, newOwner, code, abi, broadcast = false, options = {}) {
        const fee_symbol = options.fee_symbol;
        return this._connect().then(async () => {
            let feeInfo = {};
            let promises = [
                this.getAccount(contract_name)
            ];
            if (newOwner) {
                promises.push(this.getAccount(newOwner));
            }
            if(fee_symbol){
                feeInfo = await this.getAsset(fee_symbol);
            }
            return Promise.all(promises).then(results => {
                let tr = this._createTransaction();

                let opt = {
                    fee: {
                        amount: 0,
                        asset_id: feeInfo.id || "1.3.1"
                    },
                    owner: this.account_id,
                    contract: results[0].id,
                    code,
                    abi
                };
                if (newOwner) {
                    opt.new_owner = results[1].id;
                }
                tr.add_operation(tr.get_type_operation("update_contract", opt));
                return this._processTransaction(tr, broadcast);
            });
        });
    }

    /**
     * call smart contract method
     * @param contract_name {String} - The name of the smart contract
     * @param method_name {String} - Method/Action name
     * @param params {JSON} - parameters
     * @param amount_asset {String} - same to transfer eg."100 GXC"
     * @param broadcast {Boolean} - Broadcast the transaction or just return a serialized transaction
     * @param options {Object}
     * @param options.fee_symbol {String} - e.g: 'GXC'
     * @returns {Promise<any>}
     */
    callContract(contract_name, method_name, params, amount_asset, broadcast = false, options = {}) {
        const fee_symbol = options.fee_symbol;
        return this._connect().then(() => {
            if (amount_asset) {
                if (amount_asset.indexOf(" ") == -1) {
                    throw new Error("Incorrect format of asset, eg. \"100 GXC\"");
                }
            }
            let amount = amount_asset ? Number(amount_asset.split(" ").filter(o => !!o)[0]) : 0;
            let asset = amount_asset ? amount_asset.split(" ").filter(o => !!o)[1] : "GXC";
            const promises = [
                this.getAccount(contract_name),
                this.getAsset(asset)
            ];
            if(fee_symbol){
                promises.push(this.getAsset(fee_symbol));
            }

            return Promise.all(promises).then(results => {
                let acc = results[0];
                let assetInfo = results[1];
                let feeInfo = results[2] || {};
                if (!assetInfo) {
                    throw new Error(`Asset ${asset} not exist`);
                }
                amount = {
                    amount: this._accMult(amount, Math.pow(10, assetInfo.precision)),
                    asset_id: assetInfo.id
                };
                if (acc) {
                    let abi = acc.abi;
                    let act = {
                        method_name: method_name,
                        data: serializeCallData(method_name, params, abi)
                    };

                    let tr = this._createTransaction();
                    let opts = {
                        "fee": {
                            "amount": 0,
                            "asset_id": feeInfo.id || amount.asset_id
                        },
                        "account": this.account_id,
                        "contract_id": acc.id,
                        "method_name": act.method_name,
                        "data": act.data
                    };

                    if (!!amount.amount) {
                        opts.amount = amount;
                    }
                    tr.add_operation(tr.get_type_operation("call_contract", opts));
                    return this._processTransaction(tr, broadcast);
                } else {
                    throw new Error("Contract not found");
                }
            });
        });
    }

    /**
     * vote for accounts
     * @param accounts {String[]} - An array of account_names to vote
     * @param broadcast {Boolean}
     * @param options {Object}
     * @param options.fee_symbol {String} - e.g: 'GXC'
     * @returns {Promise<any>}
     */
    vote(accounts = [], broadcast = false, options = {}) {
        const fee_symbol = options.fee_symbol || "GXC";
        return new Promise((resolve) => {
            resolve(this._connect().then(() => {
                let accountPromises = accounts.map(a => this.getAccount(a));
                return Promise.all(accountPromises).then(accounts => {
                    let account_ids = accounts.map(a => a.id);
                    return Promise.all([this._query("get_objects", [[this.account_id, "2.0.0"]]), this.getAsset(fee_symbol)]).then(results => {
                        let acc = results[0][0];
                        let globalObject = results[0][1];
                        let fee_asset = results[1];
                        if (!acc) {
                            throw Error(`account_id ${this.account_id} not exist`);
                        }
                        if (!fee_asset) {
                            throw Error(`asset ${fee_symbol} not exist`);
                        }

                        let new_options = {
                            memo_key: acc.options.memo_key,
                            voting_account: acc.options.voting_account || "1.2.5"
                        };

                        let promises = [];

                        account_ids.forEach(account_id => {
                            promises.push(this._query("get_witness_by_account", [account_id]));
                            promises.push(this._query("get_committee_member_by_account", [account_id]));
                        });

                        // fetch vote_ids
                        return Promise.all(promises).then(results => {

                            // filter empty records since some of the account are not witness or committee
                            let votes = results.filter(r => r).map(r => r.vote_id);

                            // only merge you votes into current selections
                            // if you want cancel your votes, please operate it in your wallet
                            // eg. Visit https://wallet.gxb.io
                            new_options.votes = uniq(votes.concat(acc.options.votes));

                            let num_witness = 0;
                            let num_committee = 0;
                            new_options.votes.forEach(v => {
                                let vote_type = v.split(":")[0];
                                if (vote_type == "0") {
                                    num_committee += 1;
                                }
                                if (vote_type == 1) {
                                    num_witness += 1;
                                }
                            });
                            new_options.num_committee = Math.min(num_committee, globalObject.parameters.maximum_committee_count);
                            new_options.num_witness = Math.min(num_witness, globalObject.parameters.maximum_witness_count);
                            new_options.votes = new_options.votes.sort((a, b) => {
                                let a_split = a.split(":");
                                let b_split = b.split(":");
                                return parseInt(a_split[1]) - parseInt(b_split[1]);
                            });

                            let tr = this._createTransaction();

                            tr.add_operation(tr.get_type_operation("account_update", {
                                fee: {
                                    amount: 0,
                                    asset_id: fee_asset.id
                                },
                                account: this.account_id,
                                new_options: new_options,
                            }));

                            return this._processTransaction(tr, broadcast);
                        });
                    });
                });
            }));
        });
    }

    /**
     * calculate fee of a operation
     * @param operation {Object}
     * @param feeAssetId {String}
     * @returns {Promise<any>}
     */
    fee(operation, feeAssetId = "1.3.1") {
        return this._query("get_required_fees", [operation, feeAssetId]);
    }

    /**
     * accurate multiply - fix the accurate issue of javascript
     * @private
     * @param arg1
     * @param arg2
     * @returns {number}
     */
    _accMult(arg1, arg2) {
        let m = 0;
        let s1 = arg1.toString();
        let s2 = arg2.toString();
        try {
            m += s1.split(".")[1].length;
        } catch (e) {
        }
        try {
            m += s2.split(".")[1].length;
        } catch (e) {
        }
        return Number(s1.replace(".", "")) * Number(s2.replace(".", "")) / Math.pow(10, m);
    }

    /**
     *
     * @private
     */
    _connect() {
        return new Promise((resolve) => {
            if (this.connected) {
                resolve();
            } else {
                resolve(Promise.all([
                    this.getAccount(this.account),
                    this.getChainID()
                ]).then(results => {
                    let acc = results[0];
                    this.chain_id = results[1];
                    this.account_id = acc.id;
                    this.connected = true;
                    return;
                }));
            }
        });
    }

    /**
     *
     * @private
     */
    _query(method, params) {
        return this.rpc.query(method, params);
    }

    /**
     * WARNING: This function have to be used after connected
     * @returns {*}
     * @private
     */
    _createTransaction() {
        let tr = null;
        if (!this.connected) {
            throw new Error("_createTransaction have to be invoked after _connect()");
        }
        if (this.signProvider) {
            tr = new TransactionBuilder(this.signProvider, this.rpc, this.chain_id);
        } else {
            tr = new TransactionBuilder(null, this.rpc, this.chain_id);
        }

        return tr;
    }

    /**
     * process transaction
     * @private
     * @param tr
     * @param broadcast
     * @returns {Promise<any[]>}
     */
    _processTransaction(tr, broadcast) {
        return new Promise((resolve) => {
            resolve(Promise.all([tr.update_head_block(), tr.set_required_fees()]).then(() => {
                if (!this.signProvider) {
                    this.private_key && tr.add_signer(PrivateKey.fromWif(this.private_key));
                }
                tr.set_expire_seconds(DEFUALT_EXPIRE_SEC);
                if (broadcast) {
                    return tr.broadcast();
                } else {
                    return tr.finalize().then(() => {
                        return tr.sign().then(() => {
                            return tr.serialize();
                        });
                    });
                }
            }));
        });
    }

    /**
     * broadcast transaction
     * @param {TransactionBuilder} tx
     * @returns {Promise<any>}
     */
    broadcast(tx) {
        return this.rpc.broadcast(tx);
    }
}

export default GXClient;
