import GXClientFactory from "../lib";

const private_key = "5J7Yu8zZD5oV9Ex7npmsT3XBbpSdPZPBKBzLLQnXz5JHQVQVfNT";
const account_id = "gxb122";

let client = GXClientFactory.instance({
    keyProvider: private_key,
    account: account_id,
    network: "https://testnet.gxchain.org"
});

client.transfer("youxiu123", "", "1 GXC", true).then(trx => {
    console.log("transfer success", trx);
}).catch(error => {
    if (error.code === 432) {
        alert("you don't authorize identity!");
    }
    console.error(error);
});

client.vote(["math-wallet-test", "gxc-pacific"], "GXC", true).then(trx => {
    console.log("vote success", trx);
}).catch(error => {
    console.error(error);
});

client.getAccount("lzydophin94").then(res => {
    console.log("aaacccc", res);
});
