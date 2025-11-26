require('dotenv').config();
const TelegramBot= require("node-telegram-bot-api");
const sqlite3= require("sqlite3").verbose();
const axios       = require("axios");
const ethers      = require('ethers')
const artifact       = require("./artifacts/token.js").artifact;
const artifact2           = require("./artifacts/router.js").artifact;
const artifactQuoter      = require("./artifacts/quoter.js").artifact;
const artifactAAVE      = require("./artifacts/aave.js").artifact;
const crypto      = require('crypto');
// ======================================================
// CONFIG
// ======================================================
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });
const baseProvider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
const API           = "https://api.coingecko.com/api/v3";
const USDC_ADDRESS  = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // Example Sepolia
const CBBTC_ADDRESS = "0x4200000000000000000000000000000000000006"
const SWAP_ROUTER   = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
const TREASURY      = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
const ALGORITHM            = process.env.ALGORITHM;
const KEY  = Buffer.from(process.env.KEY_ALG, 'hex')//crypto.randomBytes(32); // Store this securely (env or SOPS)
const IV_LENGTH            = Number(process.env.IVLENGTH); // AES block size
const QUOTER_V2_ADDRESS = "0xC5290058841028F1614F3A6F0F5816cAd0df5E27"; // Example Base Sepolia Quoter V2
const AAVE_POOL_ADDRESS = "0xD1113dD8c1718D051EaC536FC1E30c2d0728c505"; // Example Aave V3 Pool on Base Sepolia
const QUOTER_V2_ABI = artifactQuoter;
const AAVE_POOL_ABI = artifactAAVE;

// In-memory session state
const sessions = {};

// ======================================================
// SQLITE INIT
// ======================================================
const db = new sqlite3.Database("bot.sqlite");

db.run(`
  CREATE TABLE IF NOT EXISTS usersTokens (
    telegram_id INTEGER PRIMARY KEY,
    wallet TEXT,
    private_key TEXT,
    usdc_balance REAL DEFAULT 0,
    position_status TEXT DEFAULT 'NONE',
    fear INTEGER DEFAULT 15,
    greed INTEGER DEFAULT 85
  )
`);

function encryptPrivateKey(privateKey, key) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return {
        iv: iv.toString('hex'),
        authTag,
        data: encrypted
    };
}
function decryptPrivateKey(encryptedObj, key) {
    const { iv, authTag, data } = encryptedObj;
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

// ======================================================
// HELPERS
// ======================================================
function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function runExec(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(true);
        });
    });
}

async function getFearGreed() {
    const res = await axios.get("https://api.alternative.me/fng/?limit=1");
   // console.log(res.data.data[0].value)
    return parseInt(res.data.data[0].value);
}

// 🪙 Helper: get price & 24h change
async function getPrice(symbol) {
    try {
        console.log(`${API}/coins/`+ symbol)

        const res = await axios.get(`${API}/coins/`+ symbol, {

        });

        const data = res.data[symbol];

        console.log(res.data.market_data.current_price.usd)
        return {
            price: res.data.market_data.current_price.usd,

        };
    } catch (err) {
        console.error(err);

        return 0;
    }
}

// 🪙 Helper: get price & 24h change
async function getPriceBinance(symbol) {
    try {
        console.log(`${API}/coins/`+ symbol)

        const res = await axios.get(`https://api.binance.com/api/v3/trades?symbol=`+ symbol, {

        });



        return {
            price: res.data[0].price,

        };
    } catch (err) {
        console.error(err);

        return 0;
    }
}

function generateNewWallet(chatId){
    const mnemonic = process.env.MNEMONIC;
    // ALWAYS derive from the root. Never reuse the derived node.
    const derivationPath = "m/44'/60'/0'/0/";

    // Uses ethers.HDNodeWallet.fromMnemonic which handles both the mnemonic and the path
    return ethers.HDNodeWallet.fromMnemonic(
        ethers.Mnemonic.fromPhrase(mnemonic),
        derivationPath + chatId
    );

}

// ======================================================
// BOT COMMANDS
// ======================================================

// START
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    if (msg.chat.type === "private") {

        await runExec(
            `INSERT OR IGNORE INTO usersTokens(telegram_id) VALUES(?)`,
            [chatId]
        );

        const wallet = generateNewWallet(chatId)

        await runExec(
            `UPDATE usersTokens SET wallet=?, private_key=? WHERE telegram_id=?`,
            [wallet.address, JSON.stringify(encryptPrivateKey(wallet.privateKey, KEY)), chatId]
        );

        bot.sendMessage(
            chatId, `🚀 Welcome to Simoshi!
            
The bot that buys btc when in extreme fear and sells it on extreme greed.
             
Your Deposit Address is: \`${wallet.address}\`
            
Deposit USDC through Base Blockchain in order to buy on extreme fear and sell on extreme greed. Deposit also at least 0.0001 ETH through Base Blockchain in order to pay for transactions fees.`, { parse_mode: "Markdown" });

        bot.sendMessage(
            chatId,
            `Commands:
- /status – Check portfolio
- /buyNow - Force Bot to buy BTC with USDC in walllet
- /closePosition – Close position by selling BTC for USDC
- /withdraw – Withdraw funds
- /check - Check current Fear/Greed Index
                `
        );


    }else{
        bot.sendMessage(
            chatId,
            `🚀 Welcome to Simoshi! You can now buy on extreme fear and sell on extreme greed!
Sent you a private message with your deposit address details!
`
        );

        await runExec(
            `INSERT OR IGNORE INTO usersTokens(telegram_id) VALUES(?)`,
            [msg.from.id]
        );

        // Uses ethers.HDNodeWallet.fromMnemonic which handles both the mnemonic and the path
        const wallet = generateNewWallet(msg.from.id);

        await runExec(
            `UPDATE usersTokens SET wallet=?, private_key=? WHERE telegram_id=?`,
            [wallet.address, JSON.stringify(encryptPrivateKey(wallet.privateKey, KEY)), msg.from.id]
        );
        bot.sendMessage(
            msg.from.id, `🚀 Welcome to Simoshi!
            
The bot that buys btc when in extreme fear and sells it on extreme greed.
             
Your Deposit Address is: \`${wallet.address}\`
            
Deposit USDC through Base Blockchain in order to buy on extreme fear and sell on extreme greed. Deposit also at least 0.0001 ETH through Base Blockchain in order to pay for transactions fees.`, { parse_mode: "Markdown" });

        bot.sendMessage(
            msg.from.id,
            `Commands:
- /status – Check portfolio
- /buyNow - Force Bot to buy BTC with USDC in walllet
- /closePosition – Close position by selling BTC for USDC
- /withdraw – Withdraw funds
- /check - Check current Fear/Greed Index
                `
        );
    }


});

async function executeBuyTrade(id) {
    const user = await runQuery(
        `SELECT * FROM usersTokens WHERE telegram_id=?`,
        [id]
    );
    if (!user.length) return bot.sendMessage(id, "Not registered.");


    if (user[0].wallet != null && user[0].private_key != null) {
        const balance = await baseProvider.getBalance(user[0].wallet);

        if(BigInt("10000000000000") <= BigInt(balance) ) {
            const userWallet = new ethers.Wallet(decryptPrivateKey(JSON.parse(user[0].private_key), KEY), baseProvider);

// --- Criar contrato ---
            const router = new ethers.Contract(SWAP_ROUTER, artifact2, userWallet);

            const factoryContract = new ethers.Contract(USDC_ADDRESS, artifact.abi, userWallet);
            // Check if pool already exists
            let usdcBalance = await factoryContract.balanceOf(user[0].wallet);

            let usdcBalanceBuy = usdcBalance * BigInt(997) / BigInt(1000);
            let feeAmount = BigInt(usdcBalance) - BigInt( usdcBalanceBuy);
// --- Definir quantidade ---

            const amountIn = usdcBalanceBuy; // Example: 3000 USDC (6 decimals)
            const slippageTolerance = 0.5; // Set slippage to 0.5%

            // --- 1. GET QUOTE ---
            const quoter = new ethers.Contract(QUOTER_V2_ADDRESS, QUOTER_V2_ABI, baseProvider);

            const quoteParams = {
                tokenIn: USDC_ADDRESS,
                tokenOut: CBBTC_ADDRESS,
                fee: 3000, // 0.3%
                amountIn: amountIn,
                // Set price limit to zero for the quote, as we are checking the optimal path
                sqrtPriceLimitX96: 0
            };

            let quotedAmountOut;
            try {
                // Returns tuple: [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate]
                const result = await quoter.quoteExactInputSingle(quoteParams);
                quotedAmountOut = result[0]; // The first element is the expected amountOut

                bot.sendMessage(id, `Quoted BTC output (before slippage): ${ethers.formatEther(quotedAmountOut)}`);
            } catch (e) {
                console.error("Quoter Error:", e);
                return bot.sendMessage(id, "Error fetching price quote. Trade aborted.");
            }

            // --- 2. CALCULATE MINIMUM OUTPUT (SLIPPAGE) ---
            // amountOutMinimum = quotedAmountOut * (1 - slippageTolerance / 100)
            const minAmount = quotedAmountOut * BigInt(10000) / BigInt(10000 + slippageTolerance * 100);
            const amountOutMinimum = minAmount / BigInt(100);

            // Adjust to BigInt arithmetic:
            // Example: 0.5% slippage means min amount is 99.5% of quote.
            const numerator = BigInt(1000) - BigInt(slippageTolerance * 10); // 1000 - 5 = 995
            const denominator = BigInt(1000);

            const amountOutMin = (quotedAmountOut * numerator) / denominator;// sem limite mínimo (ideal usar quoter)

// --- Aprovar o router ---
            const ERC20_ABI = [
                "function approve(address spender, uint256 amount) external returns (bool)",
                "function transfer(address to, uint256 amount) external returns (bool)"
            ];

            bot.sendMessage(id, "Buying BTC...");

            try{
                const wethContract2 = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, userWallet);
                const t2 = await wethContract2.transfer(TREASURY, feeAmount);

                await t2.wait();
                const t = await wethContract2.approve(SWAP_ROUTER, amountIn);

                await t.wait();

// --- Criar os parâmetros do swap ---
                const params = {
                    tokenIn: USDC_ADDRESS,
                    tokenOut: CBBTC_ADDRESS,
                    fee: 3000, // 0.05%
                    recipient: await userWallet.getAddress(),
                    deadline: Math.floor(Date.now() / 1000) + 60 * 5, // 5 minutos
                    amountIn,
                    amountOutMinimum: amountOutMin,
                    sqrtPriceLimitX96: 0
                };

// --- Executar swap ---
                const transactionStatus = await router.exactInputSingle(params, {
                    gasLimit: 300000
                });

                await transactionStatus.wait();

                bot.sendMessage(
                    id, "Successfully bought BTC!");
            }catch (e) {
                bot.sendMessage(
                    id, "Error buying BTC!"+e.toString());
            }

        }
    }
}

async function executeSellTrade(id) {
    const user = await runQuery(
        `SELECT * FROM usersTokens WHERE telegram_id=?`,
        [id]
    );
    if (!user.length) return bot.sendMessage(id, "Not registered.");
    console.log(
        id,user[0]);
    if(user[0].wallet != null && user[0].wallet != null) {
        const userWallet = new ethers.Wallet(decryptPrivateKey(JSON.parse(user[0].private_key), KEY), baseProvider);

// --- Criar contrato ---
        const router = new ethers.Contract(SWAP_ROUTER, artifact2 , userWallet);

        const factoryContract2 = new ethers.Contract(CBBTC_ADDRESS, artifact.abi, userWallet);
        // Check if pool already exists
        let cbbtcBalance = await factoryContract2.balanceOf(user[0].wallet);

        const amountIn = cbbtcBalance* BigInt(997) / BigInt(1000); // Example: 3000 USDC (6 decimals)
        const slippageTolerance = 0.5; // Set slippage to 0.5%

        let feeAmount = cbbtcBalance - amountIn;
        // --- 1. GET QUOTE ---
        const quoter = new ethers.Contract(QUOTER_V2_ADDRESS, QUOTER_V2_ABI, baseProvider);

        const quoteParams = {
            tokenIn: CBBTC_ADDRESS,
            tokenOut: USDC_ADDRESS,
            fee: 3000, // 0.3%
            amountIn: amountIn,
            // Set price limit to zero for the quote, as we are checking the optimal path
            sqrtPriceLimitX96: 0
        };

        let quotedAmountOut;
        try {
            // Returns tuple: [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate]
            const result = await quoter.quoteExactInputSingle(quoteParams);
            quotedAmountOut = result[0]; // The first element is the expected amountOut

            bot.sendMessage(id, `Quoted USDC output (before slippage): ${ethers.formatUnits(quotedAmountOut,6)}`);
        } catch (e) {
            console.error("Quoter Error:", e);
            return bot.sendMessage(id, "Error fetching price quote. Trade aborted.");
        }

        // --- 2. CALCULATE MINIMUM OUTPUT (SLIPPAGE) ---
        // amountOutMinimum = quotedAmountOut * (1 - slippageTolerance / 100)
        const minAmount = quotedAmountOut * BigInt(10000) / BigInt(10000 + slippageTolerance * 100);
        const amountOutMinimum = minAmount / BigInt(100);

        // Adjust to BigInt arithmetic:
        // Example: 0.5% slippage means min amount is 99.5% of quote.
        const numerator = BigInt(1000) - BigInt(slippageTolerance * 10); // 1000 - 5 = 995
        const denominator = BigInt(1000);

        const amountOutMin = (quotedAmountOut * numerator) / denominator;// sem limite mínimo (ideal usar quoter)


// --- Aprovar o router ---
        const ERC20_ABI = [
            "function approve(address spender, uint256 amount) external returns (bool)",
            "function transfer(address to, uint256 amount) external returns (bool)"
        ];
        const wethContract2 = new ethers.Contract(CBBTC_ADDRESS, ERC20_ABI, userWallet);

        const t2 = await wethContract2.transfer(TREASURY, feeAmount);
        await t2.wait()
        ;
        const t = await wethContract2.approve(SWAP_ROUTER, amountIn);

        await t.wait();

// --- Criar os parâmetros do swap ---
        const params = {
            tokenIn: CBBTC_ADDRESS,
            tokenOut: USDC_ADDRESS,
            fee: 3000, // 0.05%
            recipient: await userWallet.getAddress(),
            deadline: Math.floor(Date.now() / 1000) + 60 * 5, // 5 minutos
            amountIn,
            amountOutMinimum: amountOutMin,
            sqrtPriceLimitX96: 0
        };

// --- Executar swap ---
        const transactionStatus = await router.exactInputSingle(params, {
            gasLimit: 300000
        });
        await transactionStatus.wait();

        bot.sendMessage(
            id,"Successfully sold BTC!");

    }
}

// REGISTER WALLET
bot.onText(/\/buyNow/, async (msg) => {
    const chatId = msg.chat.id;
    try{
        await executeBuyTrade(chatId);
    }catch(e){

    }

});

// REGISTER WALLET
bot.onText(/\/closePosition/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        await executeSellTrade(chatId);
    }catch(e){

    }
});

// CHECK STATUS
bot.onText(/\/status/, async (msg) => {
    let chatId = msg.chat.id;

    if (msg.chat.type === "private") {
        const user = await runQuery(
            `SELECT * FROM usersTokens WHERE telegram_id=?`,
            [chatId]
        );
        if (!user.length) return bot.sendMessage(chatId, "Not registered.");
        console.log(
            chatId,user[0]);
        console.log(user);
        if(user[0].wallet != null && user[0].wallet != null){
            const userWallet = new ethers.Wallet(decryptPrivateKey(JSON.parse(user[0].private_key), KEY), baseProvider);

            const balance = await baseProvider.getBalance(user[0].wallet);

            const u = user[0];

            const factoryContract = new ethers.Contract(USDC_ADDRESS, artifact.abi, userWallet);
            // Check if pool already exists
            let usdcBalance = await factoryContract.balanceOf(user[0].wallet);

            const factoryContract2 = new ethers.Contract(CBBTC_ADDRESS, artifact.abi, userWallet);
            // Check if pool already exists
            let cbbtcBalance = await factoryContract2.balanceOf(user[0].wallet);
            let ethPrice, usdcPrice, btcPrice;
            try{
                ethPrice = await getPriceBinance("ETHUSDT");
                usdcPrice = {price:1};
                btcPrice = await getPriceBinance("BTCUSDT");
            }catch (e) {

            }

            let ethHoldings = Number(Number(ethers.formatEther(balance)) * Number(ethPrice.price)).toFixed(2);

            let usdcHoldings = Number(Number(ethers.formatUnits(usdcBalance, 6)) * Number(usdcPrice.price)).toFixed(2);

            let btcHoldings = Number(Number(ethers.formatEther(cbbtcBalance)) * Number(btcPrice.price)).toFixed(2);

            let totalHoldingas = Number(ethHoldings) + Number(usdcHoldings) + Number(btcHoldings);

            bot.sendMessage(
                chatId,
                `
📊 *Your Portfolio*
Wallet: \`${u.wallet || "Not set"}\`
ETH Balance: ${ethers.formatEther(balance)}  ($${ethHoldings})
USDC Balance: ${ethers.formatUnits(usdcBalance, 6)} ($${usdcHoldings})
BTC Balance: ${ethers.formatEther(cbbtcBalance)} ($${btcHoldings})
Total Portfolio Balance: $${totalHoldingas.toFixed(2)}
    `,
                { parse_mode: "Markdown" }
            );
        }
    }else{
        let userId = msg.from.id;
        const user = await runQuery(
            `SELECT * FROM usersTokens WHERE telegram_id=?`,
            [userId]
        );
        if (!user.length) return bot.sendMessage(chatId, "Not registered.");

        if(user[0].wallet != null && user[0].wallet != null){
            const userWallet = new ethers.Wallet(decryptPrivateKey(JSON.parse(user[0].private_key), KEY), baseProvider);

            const balance = await baseProvider.getBalance(user[0].wallet);

            const u = user[0];

            const factoryContract = new ethers.Contract(USDC_ADDRESS, artifact.abi, userWallet);
            // Check if pool already exists
            let usdcBalance = await factoryContract.balanceOf(user[0].wallet);

            const factoryContract2 = new ethers.Contract(CBBTC_ADDRESS, artifact.abi, userWallet);
            // Check if pool already exists
            let cbbtcBalance = await factoryContract2.balanceOf(user[0].wallet);
            let ethPrice, usdcPrice, btcPrice;
            try{
                ethPrice = await getPriceBinance("ethereum");
                usdcPrice = {price:1}//await getPrice("usd-coin");
                btcPrice = await getPriceBinance("bitcoin");
            }catch (e) {

            }

            let ethHoldings = Number(Number(ethers.formatEther(balance)) * Number(ethPrice.price)).toFixed(2);

            let usdcHoldings = Number(Number(ethers.formatUnits(usdcBalance, 6)) * Number(usdcPrice.price)).toFixed(2);

            let btcHoldings = Number(Number(ethers.formatEther(cbbtcBalance)) * Number(btcPrice.price)).toFixed(2);

            let totalHoldingas = Number(ethHoldings) + Number(usdcHoldings) + Number(btcHoldings);

            bot.sendMessage(
                chatId,
                `
📊 *Your Portfolio*
Wallet: \`${u.wallet || "Not set"}\`
ETH Balance: ${ethers.formatEther(balance)}  ($${ethHoldings})
USDC Balance: ${ethers.formatUnits(usdcBalance, 6)} ($${usdcHoldings})
BTC Balance: ${ethers.formatEther(cbbtcBalance)} ($${btcHoldings})
Total Portfolio Balance: $${totalHoldingas.toFixed(2)}
    `,
                { parse_mode: "Markdown" }
            );
        }
    }



});

bot.onText(/\/check/, async (msg) => {
    bot.sendMessage(msg.chat.id, `Current Fear/Greed Index: ${await getFearGreed()}`);
});

bot.onText(/\/help/, async (msg) => {
    bot.sendMessage(msg.chat.id, `The bot will buy when sentiment of fear is below or equal to 15 and sell when above or equal to 85.`);
});

// WITHDRAW
bot.onText(/\/withdraw/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (msg.chat.type === "private") {

        sessions[chatId] = {step: "ASK_ASSET"};

        const user = await runQuery(
            `SELECT * FROM usersTokens WHERE telegram_id=?`,
            [chatId]
        );
        if (!user.length) return bot.sendMessage(chatId, "Not registered. Call /start to create a wallet and deposit funds.");

        bot.sendMessage(chatId, `What asset do  do you want to withdraw? ETH, BTC or USDC? Input ALL to withdraw all.`);
    }else{
        bot.sendMessage(chatId, `Withdraws must only be called in private messages with the bot to ensure privacy.`);

    }

});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    if (!sessions[chatId]) return; // User not in withdraw flow

    const state = sessions[chatId];



    // STEP 1 - Asset
    if (state.step === 'ASK_ASSET') {
        state.asset = text.toUpperCase();
        if(state.asset !== "ETH" && state.asset !== "BTC" && state.asset !== "USDC" && state.asset !== "ALL"){
            bot.sendMessage(chatId, "Invalid Asset. Valid assets are ETH, BTC and USDC.");
            delete sessions[chatId]; // Clear session
        }else if(state.asset === "ALL"){
            state.step = 'ASK_WALLET';
            bot.sendMessage(chatId, "Please enter the destination wallet address:");
            state.amount = "ALL"
        }else{
            state.step = 'ASK_AMOUNT';
            bot.sendMessage(chatId, "Please enter the amount you want to withdraw. Input ALL to withdraw all.");
        }
        return;
    }

    // STEP 2 - Amount
    if (state.step === 'ASK_AMOUNT') {

            bot.sendMessage(chatId, "Please enter the destination wallet address:");

        state.amount = text;

        state.step = 'ASK_WALLET';

        return;
    }

    let wall;
    // STEP 3 - Wallet
    if (state.step === 'ASK_WALLET') {
        state.wallet = text;


        wall = text;


        function isValidEthereumAddress(address) {
            return ethers.isAddress(address);
        }
        if(isValidEthereumAddress(wall)){
            bot.sendMessage(
                chatId,
                `🧾 Confirm withdrawal:\n\n` +
                `Asset: ${state.asset}\n` +
                `Amount: ${state.amount}\n` +
                `Destination: ${wall.toString()}\n\n` +
                `Text OK to confirm transaction...`
            );

            // TODO: execute your blockchain transfer here

            // Example:
            // await withdrawFunds(state.asset, state.amount, state.wallet);

            state.step = 'ASK_CONFIRM';
        }else{
            delete sessions[chatId]; // Clear session
            bot.sendMessage(chatId, "Invalid destination wallet.");
        }



    }

    if (state.step === 'ASK_CONFIRM') {
        if(text.toUpperCase() === "OK") {



            const user = await runQuery(
                `SELECT * FROM usersTokens WHERE telegram_id=?`,
                [chatId]
            );
            if (!user.length) {
                delete sessions[chatId]; // Clear session
                return bot.sendMessage(chatId, "Not registered. Call /start to create a wallet and deposit funds.");
            }

            if(user[0].wallet != null && user[0].wallet != null) {

                bot.sendMessage(chatId, "Withdrawing...");
                const userWallet = new ethers.Wallet(decryptPrivateKey(JSON.parse(user[0].private_key), KEY), baseProvider);

                try{
                    if (state.asset === "BTC" || state.asset === "ALL") {
                        const factoryContract2 = new ethers.Contract(CBBTC_ADDRESS, artifact.abi, userWallet);
                        // Check if pool already exists
                        let cbbtcBalance = await factoryContract2.balanceOf(user[0].wallet);

                       if(BigInt(cbbtcBalance) > BigInt(0)) {
                           console.log(state.amount)
                           let amount = (state.amount !== "ALL") ? ethers.parseEther(state.amount): cbbtcBalance;

                           let btcTx = await factoryContract2.transfer(state.wallet, amount);

                            console.log(btcTx.hash);
                            await btcTx.wait();
                        }
                    }

                    if (state.asset === "USDC" || state.asset === "ALL") {
                        const factoryContract = new ethers.Contract(USDC_ADDRESS, artifact.abi, userWallet);
                        // Check if pool already exists
                        let usdcBalance = await factoryContract.balanceOf(user[0].wallet);
                        let amount = (state.amount !== "ALL") ? ethers.parseUnits(state.amount, 6): usdcBalance;

                        if(BigInt(usdcBalance) > BigInt(0)){
                            let txUSDC = await factoryContract.transfer(state.wallet,amount);

                            await txUSDC.wait();
                        }

                    }
                    if (state.asset === "ETH" || state.asset === "ALL") {
                        let bal = await baseProvider.getBalance(user[0].wallet);

                        let amount = (state.amount !== "ALL") ? ethers.parseEther(state.amount): bal;

                        // 2. Determine Gas Price (EIP-1559)
                        const feeData = await baseProvider.getFeeData();

                        // We should always have maxFeePerGas on an EIP-1559 network
                        if (!feeData.maxFeePerGas) {
                            throw new Error("Provider did not return maxFeePerGas for EIP-1559.");
                        }

                        // 3. Calculate Maximum Cost
                        const maxFeePerGas = feeData.maxFeePerGas;
                        const GAS_UNITS_SIMPLE_TRANSFER = BigInt(21000)
                        // 2. Calculate Maximum Cost: Max Cost = Gas Units * Max Fee Per Gas
                        const maxCostWei = GAS_UNITS_SIMPLE_TRANSFER * maxFeePerGas;

                        // Add a small safety buffer (e.g., 5%)
                        const buffer = BigInt(105);
                        const maxRequiredETH = (maxCostWei * buffer) / BigInt(100);

                        let tx = await userWallet.sendTransaction({
                            to: state.wallet.toString(),
                            value: amount - maxRequiredETH
                        });

// Often you may wish to wait until the transaction is mined
                        let receipt = await tx.wait();
                    }
                }catch (e){
                    console.log(e)
                }



                bot.sendMessage(chatId, "✅ Withdrawal submitted successfully!");

                delete sessions[chatId]; // Clear session
            }
        }
    }
});

/**
 * Approves the Aave Pool to spend USDC, then executes the supply transaction.
 * @param {string} userId - Telegram ID of the user.
 */
async function depositUsdcToAave(userId, typeChat) {

        const user = await runQuery(
            `SELECT * FROM usersTokens WHERE telegram_id=?`,
            [userId]
        );
        if (!user.length) return bot.sendMessage(userId, "Not registered.");

        console.log(user);
        if (user[0].wallet != null && user[0].private_key != null) {
            const userWallet = new ethers.Wallet(decryptPrivateKey(JSON.parse(user[0].private_key), KEY), baseProvider);

            const balance = await baseProvider.getBalance(user[0].wallet);

            const u = user[0];

            const factoryContract = new ethers.Contract(USDC_ADDRESS, artifact.abi, userWallet);
            // Check if pool already exists
            let usdcBalance = await factoryContract.balanceOf(user[0].wallet);

            // Decrypt the private key
            let decryptedPrivateKey;
            try {
                const encryptedObj = JSON.parse(u.private_key);
                decryptedPrivateKey = decryptPrivateKey(encryptedObj, KEY);
            } catch (e) {
                console.error(`Error decrypting key for user ${userId}:`, e);
                return bot.sendMessage(userId, "Error processing deposit: Could not decrypt key.");
            }

        const aavePoolContract = new ethers.Contract(AAVE_POOL_ADDRESS, AAVE_POOL_ABI, userWallet);

            try {
                //bot.sendMessage(userId, `Processing deposit of ${ethers.formatUnits(usdcBalance, 6)} USDC to`);

                // --- STEP 1: APPROVAL ---
                // Approve the Aave Pool to spend the USDC amount
                const approveTx = await factoryContract.approve(AAVE_POOL_ADDRESS, usdcBalance);
               // bot.sendMessage(userId, `1/2 Approval transaction sent: ${approveTx.hash}`);
                await approveTx.wait();

                console.log(`User ${userId} USDC approval successful.`);

                console.log(USDC_ADDRESS)
                console.log(usdcBalance)
                console.log(user[0].wallet.toString())
                // --- STEP 2: SUPPLY ---
                // Deposit the USDC into the Aave Pool
                // supply(asset, amount, onBehalfOf, referralCode)
                const supplyTx = await aavePoolContract.supply(
                    USDC_ADDRESS,
                    BigInt(usdcBalance),
                    user[0].wallet.toString(), // onBehalfOf: The user's own address
                    0 // referralCode: 0
                );

                bot.sendMessage(userId, `2/2 Supply transaction sent: ${supplyTx.hash}`);
                await supplyTx.wait();

                // --- SUCCESS ---
                bot.sendMessage(
                    userId,
                    `✅ Success! Deposited ${ethers.formatUnits(usdcBalance, 6)} USDC into !`
                );

            } catch (error) {
                console.error(`Aave Deposit Error for user ${userId}:`, error);
                bot.sendMessage(
                    userId,
                    "⚠️ Deposit failed! An error occurred during Approval or Supply. Check your ETH balance for gas."+error.toString()
                );
            }
        }

}

// ======================================================
// AUTO TRADING LOOP
// ======================================================
async function runAutoTrading() {
    try {
        const fear = await getFearGreed();


        const users = await runQuery(`SELECT * FROM usersTokens`);

        for (const u of users) {
            if (!decryptPrivateKey(JSON.parse(u.private_key), KEY)) continue;
            const userWallet = new ethers.Wallet(decryptPrivateKey(JSON.parse(u.private_key), KEY), baseProvider);

            const balance = await baseProvider.getBalance(u.wallet);




            // BUY — Extreme Fear
                if (fear <= u.fear) {


                        const factoryContract = new ethers.Contract(USDC_ADDRESS, artifact.abi, userWallet);
                        // Check if pool already exists
                        let usdcBalance = await factoryContract.balanceOf(u.wallet);

                        if(BigInt(usdcBalance) > BigInt(1000)){
                            if(BigInt("100000000000000") <= BigInt(balance) ){
                                //await depositUsdcToAave(u.telegram_id)
                                  await executeBuyTrade(u.telegram_id);
                                bot.sendMessage(
                                    u.telegram_id,
                                    `😱 Extreme Fear (${fear}) → BUY executed!`
                                );
                            }else{
                                bot.sendMessage(
                                    u.telegram_id,
                                    `You don't have enough ether in your wallet to process transactions, please deposit at least 0.0001 ETH!`
                                );
                            }
                        }



                }

                // SELL — Extreme Greed
                if (fear >= u.greed) {
                    const factoryContract = new ethers.Contract(CBBTC_ADDRESS, artifact.abi, userWallet);
                    // Check if pool already exists
                    let btcBalance = await factoryContract.balanceOf(u.wallet);

                    if(BigInt(btcBalance) > BigInt(1000)) {

                        if(BigInt("100000000000000") <= BigInt(balance) ) {
                            await executeSellTrade(u.telegram_id);

                            bot.sendMessage(
                                u.telegram_id,
                                `🤩 Extreme Greed (${fear}) → SELL executed!`
                            );
                        }else{
                            bot.sendMessage(
                                u.telegram_id,
                                `You don't have enough ether in your wallet to process transactions, please deposit at least 0.0001 ETH!`
                            );
                        }
                    }
                }


        }
    } catch (e) {
        console.error(e);
    }
}



// Run every 12 hours
setInterval(runAutoTrading, 43200_000);

console.log("Telegram bot running...");