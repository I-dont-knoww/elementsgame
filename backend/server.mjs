import { connect } from 'http2';
import * as websocket from './websocket.mjs';

const port = process.env.PORT || 3000;
const elementName = ['Hydrogen', 'Helium', 'Lithium', 'Beryllium', 'Boron', 'Carbon', 'Nitrogen', 'Oxygen', 'Fluorine', 'Neon', 'Sodium', 'Magnesium', 'Aluminium', 'Silicon', 'Phosphorus', 'Sulfur', 'Chlorine', 'Argon', 'Potassium', 'Calcium', 'Scandium', 'Titanium', 'Vanadium', 'Chromium', 'Manganese', 'Iron', 'Cobalt', 'Nickel', 'Copper', 'Zinc', 'Gallium', 'Germanium', 'Arsenic', 'Selenium', 'Bromine', 'Krypton', 'Rubidium', 'Strontium', 'Yttrium', 'Zirconium', 'Niobium', 'Molybdenum', 'Technetium', 'Ruthenium', 'Rhodium', 'Palladium', 'Silver', 'Cadmium', 'Indium', 'Tin', 'Antimony', 'Tellurium', 'Iodine', 'Xenon', 'Caesium', 'Barium', 'Lanthanum', 'Cerium', 'Praseodymium', 'Neodymium', 'Promethium', 'Samarium', 'Europium', 'Gadolinium', 'Terbium', 'Dysprosium', 'Holmium', 'Erbium', 'Thulium', 'Ytterbium', 'Lutetium', 'Hafnium', 'Tantalum', 'Tungsten', 'Rhenium', 'Osmium', 'Iridium', 'Platinum', 'Gold', 'Mercury', 'Thallium', 'Lead', 'Bismuth', 'Polonium', 'Astatine', 'Radon', 'Francium', 'Radium', 'Actinium', 'Thorium', 'Protactinium', 'Uranium', 'Neptunium', 'Plutonium', 'Americium', 'Curium', 'Berkelium', 'Californium', 'Einsteinium', 'Fermium', 'Mendelevium', 'Nobelium', 'Lawrencium', 'Rutherfordium', 'Dubnium', 'Seaborgium', 'Bohrium', 'Hassium', 'Meitnerium', 'Darmstadtium', 'Roentgenium', 'Copernicium', 'Nihonium', 'Flerovium', 'Moscovium', 'Livermorium', 'Tennessine', 'Oganesson']
    .map(v => v.toLowerCase());

let elementsUsed, awaitingInput, lastUser, turn, reported;
const users = {};

class User {
    constructor(connection) {
        this.turn = -1;
        this.lost = false;

        this.connection = connection;
    }
}

function resetGame() {
    console.log('GAME RESET');
    for (let i in users) users[i].connection.send(`RESET`);
    sendPlayers();

    if (Object.keys(users).length == 0) return;

    elementsUsed = [];
    awaitingInput = null;
    lastUser = null;
    turn = -1;
    
    let newTurn = 0;
    for (let i in users) {
        users[i].turn = newTurn;
        users[i].lost = false;
        newTurn++;
    }

    getNewUser();
}

function wasLoss() {
    if (!lastUser) return false;

    const lastElement = elementsUsed.at(-1).toLowerCase();
    return !elementName.includes(lastElement) || elementsUsed.filter(v => v == lastElement).length > 1;
}

function sendLoss(user) {
    user.lost = true;
    user.connection.send('LOST');
    console.log(`LOST ${user.turn}`);

    sendPlayers();
    
    if (user == awaitingInput) getNewUser();

    const lastFew = Object.values(users).filter(v => !v.lost);
    if (lastFew.length == 1) {
        lastFew[0].connection.send('WIN');
        resetGame();
    }
}

function sendPlayers() {
    for (let i in users) users[i].connection.send(`PLAYERS\r${Object.values(users).filter(v => !v.lost).length}`);
}

function sendNewElement() {
    const lastElement = elementsUsed.at(-1);
    for (let i in users) users[i].connection.send(`ELEMENT\r${lastElement}`);
}

function getUserFromTurn() {
    for (let i in users) if (users[i].turn == turn) return users[i];
    return null;
}

function getNewUser() {
    if (Object.entries(users).every(v => v.lost)) {
        resetGame();
        return;
    }

    do {
        turn++;
        turn %= Object.keys(users).length;
    } while (getUserFromTurn(turn).lost);

    console.log(`TURN: ${turn}`);

    reported = false;
    awaitingInput = getUserFromTurn(turn);
    awaitingInput.connection.send('AWAITING');
}

websocket.listen(port, (connection) => {
    const user = new User(connection);
    users[connection.key] = user;
    resetGame();

    connection.on('data', (opcode, data) => {
        if (opcode != websocket.opcodes.TEXT) return;
        const [header, info] = data.split('\r');

        if (header == 'WRONG' && !reported) {
            if (wasLoss()) sendLoss(lastUser);
            else sendLoss(user);
            reported = true;
        } else if (header == 'ELEMENT' && awaitingInput == user) {
            elementsUsed.push(info.trim().toLowerCase());
            lastUser = user;
            awaitingInput = null;

            sendNewElement();
            getNewUser();
        }
    });

    connection.on('close', (code, reason) => {
        delete users[connection.key];
        resetGame();
    });
});

['uncaughtException', 'unhandledRejection'].forEach(event =>
    process.on(event, error => {
        console.error(`Error! Event: ${event},  Message: ${error.stack || error}`);
    })
);