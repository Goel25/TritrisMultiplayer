import validator from 'validator';
import states from '../common/states.js';
import { gameTypes, boardTypes } from '../common/gameTypes.js';
import ServerMatch from './match.js';

export default class ServerRoom {
    constructor(roomCode, owner) {
        this.roomCode = roomCode;
        this.roomIsLocked = false;

        this.owner = new User(owner); //The client who created the room
        this.users = []; //An array of users

        this.match = null;

        this.state = states.LOBBY;

        this.winner = null;
        this.endMatchAt = 0;

        this.addUser(owner);

        console.log(this.owner.name + ' created room with code ' + this.roomCode);
    }

    addUser(client) {
        console.log(client.name + ' joined ' + this.roomCode);
        for (let u of this.users) {
            u.emit('room', {
                type: 'playerJoined',
                id: client.getId(),
                name: client.name
            });
        }
        this.users.push(new User(client));

        client.emit('joinedRoom', {
            code: this.roomCode,
            ownerId: this.owner.getId(),
            users: this.users.map(u => {
                return { //Just get the id and name and isSpectator and isReady
                    id: u.getId(), name: u.name, isSpectator: u.isSpectator, isReady: u.isReady
                }
            })
        });
    }

    removeUser(client) {
        for (let i = this.users.length-1; i >= 0; i--) {
            if (!this.users[i]) {
                //TODO This happens if multiple people leave simulateneously (select multiple tabs and click reload)
                console.log('There is no user index ' + i + ' in room ' + this.roomCode, this.users);
                continue;
            }
            if (this.users[i].getId() == client.getId()) {
                this.users[i].emit('leftRoom');
                this.users.splice(i, 1);
            } else {
                this.users[i].emit('room', {
                    type: 'playerLeft',
                    id: client.getId()
                });
            }
        }

        if (this.users.length == 0) {
            console.log(client.name + ' left ' + this.roomCode + ' disbanding room.');
            return true; //Disband room
        } else if (client.getId() == this.owner.getId()) {
            //Pick new owner
            const newOwner = this.users[0];
            this.owner = newOwner;
            for (let u of this.users) {
                u.emit('room', {
                    type: 'newOwner',
                    id: this.owner.getId()
                });
            }
        }

        console.log(client.name + ' left ' + this.roomCode);

        return false;
    }

    gotData(client, data) {
        const user = this.getUserById(client.getId());

        switch (data.type) {
            case 'start':
                if (user.getId() == this.owner.getId() && this.state == states.LOBBY) {
                    this.newMatch(data.settings);
                }
                break;
            case 'changeSpectator':
                if (user.getId() == this.owner.getId()) {
                    this.changeSpectator(data.id, data.isSpectator);
                }
                break;
            case 'changeReady':
                this.changeReady(user, data.isReady);
                break;
            case 'toggleLockRoom':
                if (client.getId() == this.owner.getId()) {
                    this.toggleLockRoom(data.lockRoom);
                }
                break;
            case 'inputs':
                if (this.isIngame()) {
                    this.match.gotInputs(client, data.inps);
                }
                break;
            case 'restart':
                if (this.state == states.INGAME) {
                    //If there is only 1 player and that player is the one who chose to restart
                    if (this.match.players.length === 1 && this.match.players[0].client.getId() == user.getId()) {
                        this.winner = null; //It should be null anyway, but just to make sure
                        this.endMatch();
                    }
                }
                break;
        }
    }

    newMatch(settings) {
        if (!validator.isNumeric(settings.startLevel + '')) {
            this.owner.emit('msg', { msg: 'Start level must be a number between 0 and 29' });
            return;
        } else {
            settings.startLevel = parseInt(settings.startLevel);
        }

        if (!validator.isNumeric(settings.boardType + '') || !Object.values(boardTypes).includes(settings.boardType)) {
            this.owner.emit('msg', { msg: 'Please choose a board type.' });
            return;
        } else {
            settings.boardType = parseInt(settings.boardType); //Make sure int
        }

        if (settings.quadtris !== false && settings.quadtris !== true) {
            this.owner.emit('msg', { msg: 'Please check the quadtris checkbox correctly.' });
            return;
        }

        if (!validator.isNumeric(settings.gameType + '') || !Object.values(gameTypes).includes(settings.gameType)) {
            this.owner.emit('msg', { msg: 'Please choose a game type.' });
            return;
        } else {
            settings.gameType = parseInt(settings.gameType); //Make sure int
        }

        if (settings.gameType == gameTypes.B_TYPE) {
            const min = 1;
            let max = 16;
            switch (settings.boardType) {
                case boardTypes.SMALL:
                    max = 8;
                    break;
                case boardTypes.NORMAL:
                    max = 16;
                    break;
                case boardTypes.TALL:
                    max = 24;
                    break;
            }
            const height = settings.garbageSettings.height;
            if (!validator.isNumeric(height + '') || parseInt(height) < min || parseInt(height) > max) {
                this.owner.emit('msg', { msg: `Please choose a garbage height between ${min} and ${max}` });
                return;
            }

            const density = settings.garbageSettings.density;
            if (!validator.isNumeric(density + '') || parseInt(density) < 1 || parseInt(density) > 99) {
                this.owner.emit('msg', { msg: `Please choose a garbage density between 1 and 99` });
                return;
            }

            //Make sure they are ints
            settings.garbageSettings.height = parseInt(settings.garbageSettings.height);
            settings.garbageSettings.density = parseInt(settings.garbageSettings.density);
        }

        const players = this.users.filter(u => !u.isSpectator).map(u => u.client);

        if (players.length === 0) {
            this.owner.emit('msg', { msg: 'There must be at least 1 player.' });
            return;
        }

        console.log(`Starting match between ${players.map(c => c.name).join(', ')}`, settings);

        this.winner = null;
        this.match = new ServerMatch(players, settings);
        for (let u of this.users) {
            u.emit('room', {
                type: 'matchStarted',
                playerIds: players.map(p => p.getId()),
                settings: this.match.settings
            });
        }
        this.state = states.INGAME;
    }

    endMatch() {
        let scores = '';
        for (let p of this.match.players) {
            scores += p.client.name + ': ' + p.serverGame.score + ' | ';
        }
        console.log('Ending match in room ' + this.roomCode + '. ' + scores);

        for (let u of this.users) {
            u.emit('room', {
                type: 'matchIsOver',
                winner: this.winner
            });
            u.isReady = false;
        }
        this.match = null;
        this.state = states.LOBBY;
    }

    isIngame() {
        return (this.state == states.INGAME && this.match);
    }

    changeSpectator(id, isSpectator) {
        const valid = (isSpectator === true || isSpectator === false);
        if (!valid) {
            this.owner.emit('msg', { msg: 'Something went wrong changing the spectator' });
            return;
        }

        const user = this.getUserById(id);
        if (user) user.isSpectator = isSpectator;

        for (const u of this.users) {
            u.emit('room', {
                type: 'spectatorChanged',
                id,
                isSpectator
            });
        }
    }

    changeReady(user, isReady) {
        const valid = (isReady === true || isReady === false);
        if (!valid) {
            user.emit('msg', { msg: 'Something went wrong changing ready.' });
            return;
        }
        user.isReady = isReady;

        for (const u of this.users) {
            u.emit('room', {
                type: 'readyChanged',
                id: user.getId(),
                isReady
            });
        }
    }

    toggleLockRoom(newState) {
        this.roomIsLocked = newState;
        this.owner.emit('room', {
            type: 'roomLocked',
            roomIsLocked: this.roomIsLocked
        });
    }

    physicsUpdate() {
        if (this.isIngame()) {
            this.match.physicsUpdate();

            const isOver = this.match.isOver();
            if (isOver.over) {
                if (!this.match.someoneHasWon) {
                    //Once one person wins, don't set a new winner for that match
                    this.match.someoneHasWon = true;
                    this.winner = isOver.winner;
                }

                if (this.endMatchAt == -1) { //The match just ended
                    this.endMatchAt = Date.now() + isOver.delay;
                }
                if (isOver.delay === 0 || Date.now() >= this.endMatchAt) { //The match is still over, wait is over
                    this.endMatch();
                }
            } else {
                //Match isn't over yet
                this.endMatchAt = -1;
            }
        }
    }

    clientsUpdate() {
        if (this.isIngame()) {
            const spectatorClients = this.users.filter(u => u.isSpectator).map(s => s.client);
            this.match.clientsUpdate(spectatorClients);
        }
    }

    hasPlayer(client) {
        for (let u of this.users) {
            if (u.getId() == client.getId()) return true;
        }
        return false;
    }

    getUserById = id => {
        for (let u of this.users) {
            if (u.getId() == id) return u;
        }
        return null;
    }
}

class User {
    constructor(client) {
        this.client = client;
        this.name = this.client.name;
        this.isReady = false;
        this.isSpectator = false;
    }

    getId = () => {
        return this.client.userId;
    }

    emit = (name, data) => {
        this.client.emit(name, data);
    }
}
