let sessionIdtoUserId = new Map(); //sessionIdtoUserId[sessionId] = userId
let clients = new Map(); //users[userId] = Client

//For generating ids
const alphabet = [];
for (let i = 'a'.charCodeAt(0); i <= 'z'.charCodeAt(0); i++) alphabet.push(String.fromCharCode(i));
for (let i = 'A'.charCodeAt(0); i <= 'Z'.charCodeAt(0); i++) alphabet.push(String.fromCharCode(i));
for (let i = '0'.charCodeAt(0); i <= '9'.charCodeAt(0); i++) alphabet.push(String.fromCharCode(i));

function generateRandomId(notIn) {
    let str = '';
    do {
        str = '';
        for (let i = 0; i < 16; i++) str += alphabet[Math.floor(Math.random() * alphabet.length)];
    } while (notIn.has(str));
    //It is probably quite unnecesary to check for collisions...
    return str;
}

export function addClient(socket) {
    let newUser = true;
    if (socket.handshake.auth.hasOwnProperty('sessionId') && sessionIdtoUserId.has(socket.handshake.auth.sessionId)) {
        newUser = false;
    }

    let client;
    let sessionId, userId;
    if (newUser) {
        sessionId = generateRandomId(sessionIdtoUserId);
        userId = generateRandomId(clients);
        sessionIdtoUserId.set(sessionId, userId);

        client = new Client(socket, userId);
        clients.set(userId, client);

        console.log('New Client ' + sessionId + ' userId: ' + userId);

        socket.emit('auth', {
            sessionId, userId
        });
    } else {
        sessionId = socket.handshake.auth.sessionId;
        userId = sessionIdtoUserId.get(sessionId);

        client = clients.get(userId);
        client.socket = socket;

        console.log('Old Client ' + sessionId + ' userId: ' + userId);

        socket.emit('reAuth', {
            sessionId, userId,

        });
    }

    return client;
}

class Client {
    constructor(socket, userId) {
        this.socket = socket;
        this.userId = userId;
        this.name = 'UnknownPlayer';
        this.leftPage = false;
    }

    getId = () => {
        return this.userId;
    }

    on = (evnt, cb) => {
        this.socket.on(evnt, cb);
    }

    emit = (name, data) => {
        this.socket.emit(name, data);
    }

    setName(n) {
        this.name = n;
    }

    isDisconnected = () => {
        return this.socket.disconnected;
    }
}
