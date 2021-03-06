import React from 'react';
import { p5, p5States } from './sketch.js';
import Lobby from './components/lobby.js';
import LobbySettings from './components/lobbySettings.js';
import Background from './components/background.js';
import COMMON_CONFIG from '../common/config.js';
import states from '../common/states.js';
import { gameTypes, boardTypes } from '../common/gameTypes.js';
import MyGame from './myGame.js';
import OtherGame from './otherGame.js';
import keyboardMap from './components/keyboardMap.js';

export default class ClientRoom extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            state: states.LOBBY,
            users: this.props.originalUsers.map(u => new User(u.name, u.id, u.isSpectator, u.isReady)),
            ownerId: this.props.ownerId,
            roomCode: this.props.roomCode,
            visualSettings: this.props.visualSettings,
            settings: {
                startLevel: 0,
                boardType: boardTypes.NORMAL,
                quadtris: false,
                gameType: gameTypes.CLASSIC,
                garbageSettings: {
                    height: 5,
                    density: 90
                }
            },
            roomIsLocked: false,
        }

        this.socket = this.props.socket;

        this.match = null;

        this.socket.on('room', this.gotData);
    }

    draw = p5 => {
        //Do everything necessary (update, show)
        this.update(p5);
        this.showGame(p5, p5.pieceImages, p5.sounds, this.props.visualSettings);
    }

    render = () => {
        switch (this.state.state) {
            case states.LOBBY:
                p5.setStateIfDifferent(p5States.BACKGROUND, new Background().draw);
                return <>
                    <Lobby
                        roomCode={this.state.roomCode}
                        users={this.state.users}
                        myId={this.socket.userId}
                        ownerId={this.state.ownerId}
                        toggleSpectator={this.changeSpectator}
                        changeReady={this.changeReady}
                        leaveRoom={this.leaveRoom}

                        controls={this.props.controls}
                        controlChanged={this.props.controlChanged}
                        resetControls={this.props.resetControls}
                        soundVolume={this.props.soundVolume}
                        setSoundVolume={this.props.setSoundVolume}
                        musicVolume={this.props.musicVolume}
                        setMusicVolume={this.props.setMusicVolume}
                        visualSettings={this.props.visualSettings}
                        visualSettingsChanged={this.props.visualSettingsChanged}
                    />

                    { this.state.ownerId == this.socket.userId ?
                        <LobbySettings
                            startGame={this.startGame}
                            startKey={this.props.controls['start'].key}

                            startLevel={this.state.settings.startLevel}
                            startLevelChanged={this.startLevelChanged}

                            boardType={this.state.settings.boardType}
                            boardTypeChanged={this.boardTypeChanged}

                            quadtris={this.state.settings.quadtris}
                            quadtrisChanged={this.quadtrisChanged}

                            gameType={this.state.settings.gameType}
                            gameTypeChanged={this.gameTypeChanged}

                            garbageSettings={this.state.settings.garbageSettings}
                            garbageHeightChanged={this.garbageHeightChanged}
                            garbageDensityChanged={this.garbageDensityChanged}

                            toggleLockRoom={this.toggleLockRoom}
                            roomIsLocked={this.state.roomIsLocked}
                        />
                    : ''
                    }
                </>
            case states.INGAME:
            case states.GAME_OVER:
                p5.setStateIfDifferent(p5States.INGAME, this.draw, this.keyPressed);
                return '';
            default:
                console.log('No state for clientRoom', this.state.state);
                return null;
        }
    }

    componentWillUnmount = () => {
        this.socket.removeListener('room');
    }

    toggleLockRoom = () => {
        this.socket.emit('room', {
            type: 'toggleLockRoom',
            lockRoom: !this.state.roomIsLocked
        });
    }

    roomLocked = roomIsLocked => {
        this.setState({ roomIsLocked });
    }

    addUser = (id, name) => {
        const newUser = new User(name, id, false, false);
        this.setState({
            users: [...this.state.users, newUser]
        });
    }

    removeUser = (id) => {
        //Make a new list without the user that left
        let newUsers = this.state.users.filter(u => u.getId() != id);
        this.setState({
            users: newUsers
        });
    }

    leaveRoom = () => {
        this.socket.emit('room', {
            type: 'leave'
        });
    }

    startGame = () => {
        //TODO Dont send B type when not b type
        this.socket.emit('room', {
            type: 'start',
            settings: this.state.settings
        });
    }

    changeSpectator = id => {
        if (this.socket.userId == this.state.ownerId) {
            this.socket.emit('room', {
                type: 'changeSpectator',
                isSpectator: !this.state.users.filter(u => u.getId() == id)[0].isSpectator,
                id
            });
        }
    }

    changeReady = () => {
        this.socket.emit('room', {
            type: 'changeReady',
            isReady: !this.getUserById(this.socket.userId).isReady
        });
    }

    startLevelChanged = evnt => {
        try {
            let lvl = parseInt(evnt.target.value);
            if (isNaN(lvl)) lvl = '';
            lvl = Math.min(29, Math.max(0, lvl));
            lvl = lvl.toString();

            const newSettings = { ...this.state.settings };
            newSettings.startLevel = lvl;
            this.setState({ settings: newSettings });
        } catch (e) {
            //They entered something wrong (like the letter e. Exponentials aren't necessary)
        }
    }

    boardTypeChanged = evnt => {
        const newSettings = { ...this.state.settings };
        newSettings.boardType = parseInt(evnt.target.value);

        this.setState({ settings: newSettings }, this.garbageHeightChanged);
    }

    quadtrisChanged = evnt => {
        const newSettings = { ...this.state.settings };
        newSettings.quadtris = evnt.target.checked;
        this.setState({ settings: newSettings });
    }

    gameTypeChanged = evnt => {
        const newSettings = { ...this.state.settings };
        newSettings.gameType = parseInt(evnt.target.value);
        this.setState({ settings: newSettings });
    }

    garbageHeightChanged = evnt => {
        //What the height is trying to be set to. If the boardType has been updated, evnt is undefined and we correct the boundaries
        let height;
        if (evnt !== undefined) {
            height = parseInt(evnt.target.value);
        } else {
            //Set a default height after the board type is changed
            switch (this.state.settings.boardType) {
                case boardTypes.SMALL:
                    height = 3;
                    break;
                case boardTypes.NORMAL:
                    height = 5;
                    break;
                case boardTypes.TALL:
                    height = 7;
                    break;
            }
        }

        if (height < 1) height = 1;
        let mx;
        switch (this.state.settings.boardType) {
            case boardTypes.SMALL:
                mx = 8;
                break;
            case boardTypes.NORMAL:
                mx = 16;
                break;
            case boardTypes.TALL:
                mx = 24;
                break;
        }
        if (height > mx) height = mx;

        if (isNaN(height)) height = "";

        const newSettings = { ...this.state.settings };
        newSettings.garbageSettings.height = height;
        this.setState({ settings: newSettings });
    }

    garbageDensityChanged = evnt => {
        let density;
        if (evnt !== undefined) density = parseInt(evnt.target.value);
        else density = 90; //Default

        if (density < 1) density = 1;
        if (density > 99) density = 99;

        if (isNaN(density)) density = "";

        const newSettings = { ...this.state.settings };
        newSettings.garbageSettings.density = density;
        this.setState({ settings: newSettings });
    }

    spectatorChanged = (id, isSpectator) => {
        const newUsers = [...this.state.users];
        for (let i = 0; i < newUsers.length; i++) {
            if (newUsers[i].getId() == id) {
                newUsers[i] = new User(newUsers[i].name, newUsers[i].getId(), isSpectator, newUsers[i].isReady);
            }
        }
        this.setState({ users: newUsers });
    }

    readyChanged = (id, isReady) => {
        const newUsers = [...this.state.users];
        for (let i = 0; i < newUsers.length; i++) {
            if (newUsers[i].getId() == id) {
                newUsers[i] = new User(newUsers[i].name, newUsers[i].getId(), newUsers[i].isSpectator, isReady);
            }
        }
        this.setState({ users: newUsers });
    }

    matchStarted = (playerIds, settings) => {
        let me = null;
        let others = [];
        for (let id of playerIds) {
            if (id == this.socket.userId) me = this.getUserById(id);
            else others.push(this.getUserById(id));
        }

        this.match = new ClientMatch(me, others, settings, this.props.controls);

        this.setState({ state: states.INGAME });
    }

    matchIsOver = winner => {
        //Unready everyone after a match
        const newUsers = [...this.state.users];
        for (let i = 0; i < newUsers.length; i++) {
            newUsers[i] = new User(newUsers[i].name, newUsers[i].getId(), newUsers[i].isSpectator, false);
        }
        this.match.setWinner(winner);

        this.setState({
            state: states.GAME_OVER,
            users: newUsers,
        });
    }

    //Update the current game
    update = p5 => {
        //Only update during a game. Not in game over
        if (this.state.state == states.INGAME && this.match) {
            this.match.update(p5, this.socket);
        }
    }

    showGame = (p5, pieceImages, sounds, visualSettings) => {
        if (this.isIngame() && this.match) {
            this.match.show(p5, pieceImages, sounds, visualSettings);
        }
        if (this.state.state == states.GAME_OVER) {
            const scale = p5.width * p5.height / (1920 * 1000);
            p5.fill(0);
            p5.textSize(35 * scale);
            const key = this.props.controls['start'].key;
            const name = keyboardMap[key];
            p5.textAlign(p5.RIGHT, p5.BOTTOM);
            p5.text(`Press [${name}] to continue.`, p5.width - 10*scale, p5.height - 10*scale);
        }
    }

    keyPressed = p5 => {
        const startKey = this.props.controls['start'].key;
        const restartKey = this.props.controls['restart'].key;
        if (p5.keyCode == startKey && this.state.state == states.GAME_OVER) { //If enter is pressed
            this.match = null;
            this.setState({
                state: states.LOBBY
            });
        }
        if (p5.keyCode == restartKey && this.state.state == states.INGAME) {
            if (this.match.otherPlayers.length === 0) { //It is just me playing
                this.socket.emit('room', {
                    type: 'restart'
                });
            }
        }
    }

    gotData = data => {
        switch (data.type) {
            case 'matchStarted':
                this.matchStarted(data.playerIds, data.settings);
                break;
            case 'matchIsOver':
                this.matchIsOver(data.winner);
                break;
            case 'playerJoined':
                this.addUser(data.id, data.name);
                break;
            case 'playerLeft':
                this.removeUser(data.id);
                break;
            case 'gotGameState':
                this.gotGameState(data.data);
                break;
            case 'newOwner':
                this.setState({
                    ownerId: data.id
                });
                break;
            case 'spectatorChanged':
                this.spectatorChanged(data.id, data.isSpectator);
                break;
            case 'readyChanged':
                this.readyChanged(data.id, data.isReady);
                break;
            case 'roomLocked':
                this.roomLocked(data.roomIsLocked);
                break;
        }
    }

    isIngame = () => {
        return this.state.state == states.INGAME || this.state.state == states.GAME_OVER;
    }

    gotGameState = d => {
        if (this.isIngame() && this.match) {
            this.match.gotGameState(d);
        }
    }

    getUserById = id => {
        for (let u of this.state.users) {
            if (u.getId() == id) return u;
        }
        return null;
    }
}

class User {
    constructor(name, id, isSpectator, isReady) {
        this.name = name;
        this.userId = id;
        this.isReady = isReady;
        this.isSpectator = isSpectator;
    }

    getId() {
        return this.userId;
    }
}

class ClientMatch {
    constructor(me, others, settings, myControls) {
        if (me === null) this.myId = null;
        else this.myId = me.getId();

        if (me !== null) this.myGame = new MyGame(me.name, myControls, settings);
        else this.myGame = null;

        this.otherPlayers = [];
        for (let other of others) {
            this.otherPlayers.push(new OtherPlayer(other.getId(), other.name, settings));
        }

        this.settings = settings;

        this.winnerId = null;

        this.nextSendData = Date.now();

        this.currentOrder = [];
        this.lastShowOrderChange = -1;
        this.minChangeOrderTime = 30 * 1000; //It can only change every 10 seconds to stop flickering
    }

    update(p5, socket) {
        if (this.myGame !== null && Date.now() > this.nextSendData) {
            this.sendData(socket);
            this.nextSendData = Date.now() + COMMON_CONFIG.CLIENT_SEND_DATA;
        }

        if (this.myGame !== null) this.myGame.clientUpdate(p5);
        for (let other of this.otherPlayers) {
            other.interpolateUpdate();
        }
    }

    sendData(socket) {
        const inps = this.myGame.getInputs();
        if (inps.length > 0) {
            socket.emit('room', {
                type: 'inputs',
                inps
            });
        }
    }

    gotGameState(d) {
        const games = d.players;
        const myData = d.yourData;

        if (myData !== null) this.myGame.gotGameState(myData);
        for (let other of this.otherPlayers) {
            const otherData = games[other.getId()];
            other.gotGameState(otherData);
        }
    }

    show(p5, pieceImages, sounds, visualSettings) {
        const allOtherGames = this.otherPlayers.map(p => p.game);
        let sortFn;
        if (this.settings.gameType = gameTypes.VERSUS) {
            sortFn = (a, b) => {
                if (b.alive === a.alive) { //They are both dead or both alive
                    return b.score - a.score; //Show highest score first
                } else if (a.alive) {
                    return -1; //Show alive games first
                } else {
                    return 1;
                }
            }
        } else {
            sortFn = (a, b) => b.score - a.score;
        }
        const desIndexes = allOtherGames.map((g, i) => {
            return { //This convuluted mess is done in order to preserve the original index when sorting
                score: g.score,
                alive: g.alive,
                index: i
            }
        }).sort(sortFn).map(obj => obj.index);
        //Creates an array with the indices from allOtherGames that is sorted based on the sortFn

        let ordersAreDiff = false;
        if (this.lastShowOrderChange === -1) {
            ordersAreDiff = true; //First order
        } else {
            //Compare if the indices are different
            for (let i = 0; i < desIndexes.length; i++) {
                if (desIndexes[i] !== this.currentOrder[i]) {
                    ordersAreDiff = true;
                    break;
                }
            }
        }

        //The orders are different and it has been long enough to change, then change
        //If there are 3 players total, the order doesn't change (except for when initialized)
        if ((this.currentOrder.length === 0 || allOtherGames.length > 2) && ordersAreDiff && Date.now() > this.lastShowOrderChange + this.minChangeOrderTime) {
            this.currentOrder = desIndexes;
            this.lastShowOrderChange = Date.now();
        }
        //Otherwise, do nothing. Once enough time has passed the order will change (if it is still different)

        let gamesToDisplay = [];
        if (this.myGame !== null) gamesToDisplay.push(this.myGame);
        gamesToDisplay.push(...this.currentOrder.map(i => allOtherGames[i])); //Convert back to game objects

        if (gamesToDisplay[0].isFlashing()) p5.background(150);
        else p5.background(100);

        const padding = 20 * (p5.width * p5.height) / (1920 * 1000);

        const mainGame = gamesToDisplay[0];
        if (gamesToDisplay.length === 1) {
            //Just show in center
            mainGame.showBig({
                p5,
                left: p5.width/2,
                centered: true,
                maxWidth: p5.width/2,
                pieceImages,
                baseGame: mainGame,
                visualSettings
            });
        } else if (gamesToDisplay.length === 2 || gamesToDisplay.length === 3) {
            const elems = mainGame.getBigElements(p5, 0, false, Infinity);
            const boardWidthToTotalWidthRatio = elems.board.w / elems.bounding.right; //The ratio from board to total width (including next box)

            const maxTotalW = (p5.width - padding) / gamesToDisplay.length - padding; //The max width including next box
            const maxBoardWidth = maxTotalW * boardWidthToTotalWidthRatio; //The max width of each board (not included next box)

            //An array of all to display (in order) from left to array
            let games = [gamesToDisplay[1], gamesToDisplay[0]];
            if (gamesToDisplay.length === 3) games.push(gamesToDisplay[2]);

            let left = padding;
            for (let g of games) { //Show them each in a row
                const gElems = g.showBig({
                    p5,
                    left,
                    centered: false,
                    maxWidth: maxBoardWidth,
                    pieceImages,
                    baseGame: mainGame,
                    visualSettings
                });
                left = gElems.bounding.right + padding;
            }
        } else {
            const elems = mainGame.getBigElements(p5, 0, false, Infinity);
            const boardWidthToTotalWidthRatio = elems.board.w / elems.bounding.right; //The ratio from board to total width (including next box)
            const maxTotalW = (p5.width - padding) / 3 - padding; //The max width including next box. Ensures a large enough partition for the left, middle and right
            const maxBoardWidth = maxTotalW * boardWidthToTotalWidthRatio; //The max width of each board (not included next box)

            const secondaryGame = gamesToDisplay[1];

            const secondaryElems = secondaryGame.showBig({
                p5,
                left: padding,
                centered: false,
                maxWidth: maxBoardWidth,
                pieceImages,
                baseGame: mainGame,
                visualSettings
            });
            const mainElems = mainGame.showBig({
                p5,
                left: secondaryElems.bounding.right + padding,
                centered: false,
                maxWidth: maxBoardWidth,
                pieceImages,
                baseGame: mainGame,
                visualSettings
            });

            const smallGames = gamesToDisplay.slice(2, gamesToDisplay.length);
            this.showSmallGames({
                p5,
                x: mainElems.bounding.right,
                games: smallGames,
                baseGame: mainGame,
                pieceImages,
                visualSettings
            });
        }

        let hasPlayedSounds = false;
        for (let g of gamesToDisplay) {
            if (g.alive && !hasPlayedSounds) {
                g.playSounds(sounds, true); //Play all sounds for the first alive game
                hasPlayedSounds = true;
            } else {
                g.playSounds(sounds, false); //Only play tritris sound
            }
        }
    }

    showSmallGames({ p5, x, games, baseGame, pieceImages, visualSettings }) {
        const gameDim = games[0].getSmallElements(0, 0, 100, 200);
        const gameRatio = gameDim.bounding.bottom / gameDim.bounding.right; //The ratio of height to width
        const boardToTotalHeightRatio = gameDim.bounding.bottom / gameDim.board.h;

        const padding = 8 * (p5.width * p5.height) / (1920 * 1000); //Padding for in between games and around the border

        const leftBorder = x + padding; //The left side
        const totalWidth = p5.width - padding - leftBorder; //The total width to fit all of the small games
        const totalHeight = p5.height - padding*10; //Padding for top and bottom
        //const gridRatio = totalHeight / totalWidth;

        let bestDiff = Infinity; //Keep track of the closest ration
        let gridW = -1; //The number of grid cells in a row
        let gridH = -1; //The number of grid cells in a column
        for (let tryGridW = 1; tryGridW <= games.length; tryGridW++) { //Loop to find the optimal grid width
            const tryGridH = Math.ceil(games.length / tryGridW);

            const gameWidth = totalWidth / tryGridW; //how wide each game will be
            const gameHeight = totalHeight / tryGridH; //How tall each game will be

            const ratioDiff = Math.abs((gameHeight / gameWidth) - gameRatio); //How close the ratios are
            if (ratioDiff < bestDiff) {
                gridW = tryGridW; //New best ratio
                gridH = tryGridH;
                bestDiff = ratioDiff;
            }
        }

        let boardWidth = (totalWidth / gridW) - padding; //The width of each game board
        let boardHeight = boardWidth * (games[0].h / games[0].w); //The height of each game board
        let cellHeight = boardHeight * boardToTotalHeightRatio; //Including the text at the bottom, the total height of the grid cell
        if ((cellHeight + padding) * gridH > totalHeight) { //If the bottom will cut it off
            cellHeight = (totalHeight / gridH) - padding; //Recalculate so that each cell is as tall as possible

            boardHeight = cellHeight / boardToTotalHeightRatio; //Calculate the board height
            boardWidth = boardHeight / (games[0].h / games[0].w); //Calculate the board width
        }

        const displayedGridHeight = cellHeight * gridH; //The total height of the grid. Allows for centering
        const verticalPadding = (p5.height - displayedGridHeight) / 2; //How much padding is needed to center

        for (let index = 0; index < games.length; index++) {
            const i = Math.floor(index / gridW); //The grid cell row
            const j = index % gridW; //The grid cell column

            let numInRow = gridW; //How many cells are in this row
            if (i == Math.floor((games.length-1) / gridW)) {
                numInRow = games.length % gridW;
                if (numInRow == 0) numInRow = gridW; //In case it is all 1 column or all 1 row
            }
            const displayedRowWidth = numInRow * (boardWidth + padding); //The total width of this row.
            const horzPadding = (p5.width - x - displayedRowWidth) / 2; //How much padding to center it

            const posX = leftBorder + horzPadding + j * (boardWidth + padding); //The top left position of the cell
            const posY = verticalPadding + i * (cellHeight + padding); //The top left position of the cell
            games[index].showSmall({
                p5,
                x: posX,
                y: posY,
                w: boardWidth,
                h: boardHeight,
                baseGame,
                pieceImages,
                visualSettings
            });
        }
    }

    setWinner(winnerId) {
        this.winnerId = winnerId;
        if (this.winnerId === null) return;

        if (this.winnerId == this.myId) {
            this.myGame.youWon();
        }
        for (const p of this.otherPlayers) {
            if (this.winnerId == p.userId) {
                p.youWon();
            }
        }
    }
}

class OtherPlayer {
    constructor(id, name, settings) {
        this.userId = id;
        this.name = name;

        this.game = new OtherGame(this.name, settings);
    }

    getId() {
        return this.userId;
    }

    youWon() {
        this.game.youWon();
    }

    interpolateUpdate() {
        this.game.interpolateUpdate();
    }

    gotGameState(d) {
        this.game.gotGameState(d);
    }
}
