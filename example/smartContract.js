import GXClientFactory from "../lib";

const private_key = "";
const account_id = "gxb122";
let client = GXClientFactory.instance({
    keyProvider: private_key,
    account: account_id,
    network: "https://testnet.gxchain.org"
});

// set broadcast to false so we could calculate the fee before broadcasting
let broadcast = true;

let contractName = "bank";

//Calling deposit method of bank contract
client.callContract(contractName, "deposit", "10 GXC", null, broadcast).then(resp => {
    let transaction = broadcast ? resp[0].trx : resp;
    let txid = broadcast ? resp[0].id : "";
    console.log(txid, JSON.stringify(transaction));


    client.getContractABI(contractName).then(abi => {
        // describe the tables
        console.log(abi.tables);

        // load the data in the tables
        let promises = abi.tables.map(table => client.getTableObjects(contractName, table.name));
        Promise.all(promises).then(infos => {
            abi.tables.forEach((table, i) => {
                console.log(table.name, infos[i]);
            });
        });
    });

}).catch(ex => {
    console.error(ex);
});
