import { Grid, Piece } from './classes.js';
import RandomGenerator from 'random-seed';
import { tritrisJSON, quadtrisJSON } from './pieces.js';

/* TODO
 *
 *  [X] Better score display - Show score differential
 *  [ ] Fix number of points for double (should be 300)
 *  [ ] Figure out deltaTime stuff - Don't update deltaTime after receiving data on myGame?
 *  [ ] Make server more authoritative. Validate inputs, ensure piece falls consistently
 *  [X] Look into obfuscating client side code (https://www.npmjs.com/package/javascript-obfuscator)
 *  [ ] Round decimals to make game more deterministic
 *  [ ] Add version numbers
 *      [ ] Disconnect message if server changed
 *      [ ] Remember last version so update dialogues and popup
 *  [X] Game id system
 *      [X] Create custom lobby
 *      [X] Spectate games
 *
 *      [X] Click create room button
 *          [X] Creates custom room with id
 *          [X] Settings
 *              [X] Change gamemode, level start, etc.
 *              [X] Set certain players to spectator
 *      [X] Join room
 *  [ ] More gamemodes
 *      [X] Quadtris
 *          [X] Fix colors (both versions of a mirror is purple)
 *          [X] Redo rotation center code
 *          [X] Make pieces.json format better (add names)
 *      [ ] B-Type
 *      [X] 4x8
 *      [ ] Bitris
 *      [ ] Invisible-Tris
 *      [ ] No next
 *  How should level starts be chosen?
 *  Database
 *      Save games / replay games
 *      Accounts
 *          Sign in with Google?
 *          Ranked matches - ELO
 *
 * Ping display (ms)
 * When one player tops out, switch the sounds to the other
 *      Same with flash
 *
 */

export class Game {
    constructor(settings) {
        this.w = 8;
        this.h = 16;
        if (settings.use4x8) {
            this.w = 4;
            this.h = 8;
        }
        this.grid = new Grid(this.w, this.h);

        this.tritrisAmt = 0; //For statistics
        const countDownLength = 3 * 1000;
        this.startTime = Date.now() + countDownLength; //A 5 second countdown before the game starts
        this.time = -countDownLength;

        this.seed = settings.seed;
        this.gen = new RandomGenerator(this.seed);
        this.numGens = 0; //Used to know how many steps to advance the rng from the initial state when the client recieves an update

        this.alive = true;

        let lvl = parseInt(settings.startLevel);
        if (lvl < 0) lvl = 0;
        if (lvl > 29) lvl = 29;
        if (lvl >= 20 && lvl <= 28) lvl = 19; //Can only start on 0-19 or 29
        this.startLevel = lvl;
        this.level = this.startLevel;
        this.lines = 0;
        this.score = 0;
        this.scoreWeights = { 1: 100, 2: 400, 3: 1200, 4: 1200*4 }; //TODO Figure out 4 line clear weight!
        //TODO The weights should be 1: 100, 2: 300, 3: 1200!!!!!!!!!!!!!!

        if (settings.quadtris)
            this.piecesJSON = quadtrisJSON;
        else
            this.piecesJSON = tritrisJSON;

        const frameRate = 60.0988; //frames per second
        const msPerFrame = 1000 / frameRate;
        this.entryDelays = [
            10 * msPerFrame,
            12 * msPerFrame,
            14 * msPerFrame, //Numbers from https://tetris.wiki/Tetris_(NES,_Nintendo)
            16 * msPerFrame,
            18 * msPerFrame,
        ];

        this.currentPiece = null; //The current piece starts as null
        this.nextPiece = null; //The next piece starts as a random piece that isn't a single triangles
        this.nextPieceIndex = null;
        this.nextPieceCount = 0; //For the ninja, will spawn multiple
        this.bag = [];
        this.spawnPiece(); //Sets the next piece
        this.spawnPiece(); //Make next piece current, and pick new next

        this.levelSpeeds = {
            0: 48,
            1: 43, //From https://tetris.wiki/Tetris_(NES,_Nintendo)
            2: 38,
            3: 33,
            4: 28,
            5: 23,
            6: 18,
            7: 13,
            8: 8,
            9: 6,
            10: 5, //Level 10-12
            13: 4, //13 - 15
            16: 3, //16 - 18
            19: 2, //19 - 28
            29: 1, //29+
        };
        for (let lvl of Object.keys(this.levelSpeeds)) {
            this.levelSpeeds[lvl] *= msPerFrame; //Make sure the are in the correct units
        }
        this.pieceSpeed = 0;
        this.setSpeed(); //This will correctly set pieceSpeed depending on which level it's starting on

        this.softDropSpeed = msPerFrame * 2; //The speed when holding down
        this.pushDownPoints = 0; //The current amount of push down points. Increases when holding down, but resets if released
        this.lastMoveDown = 750; //When the last move down was. Originally a 750ms delay for the first piece

        this.spawnNextPiece = 0;

        this.animatingUntil = 0; //How long until the line clear animation is done
        this.animatingLines = []; //Which lines are being cleared/animated
        this.maxAnimationTime = 20 * msPerFrame; //How long the animation should last

        this.inputs = [];
        this.doneInputId = -1; //The higheset input id that has been completed
        this.latestState = new GameState(this); //The game state with the highest input id completed

        this.initialGameState = new GameState(this);
    }

    goToStart() { //Resets the game so it can be replayed up to any time necessary
        this.goToGameState(this.initialGameState);
    }

    goToGameState(state) {
        this.gen = new RandomGenerator(this.seed);
        this.numGens = state.numGens;
        for (let i = 0; i < this.numGens; i++)
            this.gen.range(1); //Advance the internal state of the random number generator to match

        this.bag = [...state.bag];

        if (state.currentPieceSerialized) this.currentPiece = new Piece(state.currentPieceSerialized);
        else this.currentPiece = null;

        this.nextPieceIndex = state.nextPieceIndex;
        if (this.nextPieceIndex !== null) this.nextPiece = new Piece(this.piecesJSON[this.nextPieceIndex], this.w);
        else this.nextPiece = null;
        this.nextPieceCount = state.nextPieceCount;

        this.grid = new Grid(state.serializedGrid);

        this.tritrisAmt = state.tritrisAmt;
        this.alive = state.alive;
        this.score = state.score;
        this.level = state.level;
        this.lines = state.lines;
        this.pieceSpeed = state.pieceSpeed;
        this.pushDownPoints = state.pushDownPoints;
        this.lastMoveDown = state.lastMoveDown;

        this.spawnNextPiece = state.spawnNextPiece;
        this.animatingUntil = state.animatingUntil;
        this.animatingLines = state.animatingLines;

        this.time = state.time;
    }

    updateToTime(t, gravity) { //Go from the current time to t and do all inputs that happened during that time
        if (t < 0) {
            this.time = t; //Just set the time to the desired time.
            return; //Nothing can happen before 0 so no need to play inputs
        }
        if (this.time > t) {
            //console.log('Cannot go backwards to ' + t + ' from ' + this.time);
        }
        let nextInputId = this.inputs.length; //The id of the next input that should be played. If none should be played, it will be inputs.length

        for (let i = 0; i < this.inputs.length; i++) {
            //If there is an input (its possible an element of the array is null) and its time is greater than the current time
            if (this.inputs[i] && this.inputs[i].time > this.time) {
                nextInputId = i; //Find which input has not been played yet
                break;
            }
        }

        while (this.time < t && this.alive) {
            let deltaTime = this.pieceSpeed; // this.pieceSpeed/100; //TODO Figure out deltaTime stuff in the server
            if (this.time + deltaTime > t) {
                deltaTime = t - this.time; //Ensure the time does not go over the desired time
            }
            let input = null; //The next input to be performed
            let hasNextInput = (nextInputId < this.inputs.length); //If there is another input to be performed
            if (hasNextInput) { //TODO Prevent cheating and ensure only inputs within a reasonable amount of time are allowed and make sure the time is increasing with the id
                let nextInputTime = this.inputs[nextInputId].time; //When the next input is
                let nextInputDeltaTime = nextInputTime - this.time; //How long from now until the next input
                if (nextInputDeltaTime <= deltaTime) { //If the next input is sooner than the current deltaTime
                    deltaTime = nextInputDeltaTime; //Then go to exactly that time to perform the input
                    input = this.inputs[nextInputId];
                    nextInputId++; //Move onto the next input. There is a chance the currentPiece is null and the input will be skipped
                }
            }
            //const gravity = !input && nextInputId >= this.inputs.length; //If there are no more inputs to do, then simulate natural gravity
            this.update(deltaTime, input, gravity);
            if (input && input.id > this.doneInputId) {
                this.doneInputId = input.id; //Math.max(this.doneInputId, input.id); //Update the highest input id that has been completed
                this.updateGameState();
            }
        }
    }

    updateGameState() {
        this.latestState = new GameState(this);
    }

    update(deltaTime, input, gravity) { //Move the game forward with a timestep of deltaTime, and perform the input if it's not null
        if (!this.alive) return;

        this.time += deltaTime;

        if (this.time <= this.animatingUntil) { //Line clear animation
            this.playLineClearingAnimation();
            this.redraw = true;
        } else if (this.animatingLines.length > 0) { //Line clear animation finished
            const playSound = this.updateScoreAndLevel(); //After a line clear, update score and level and removed the lines from the grid
            if (playSound) {
                this.addSound('levelup');
            }
        }

        //Spawn the next piece after entry delay
        if (this.shouldSpawnPiece()) {
            this.spawnPiece();
            this.lastMoveDown = this.time;
            if (!this.isValid(this.currentPiece)) {
                this.alive = false; //If the new piece is already blocked, game over
                this.updateGameState();
                this.addSound('topout');
            }
            this.redraw = true;
            this.addSound('fall');
        }

        //Piece Movement
        if (this.currentPiece !== null) {
            if (input) { //It is time for the input to be performed
                const moveData = this.movePiece(input.horzDir, input.rot, input.vertDir);
                if (moveData.playSound) this.addSound('move');
                if (input.vertDir) {
                    if (input.softDrop) this.pushDownPoints++; //Pushing down
                    else this.pushDownPoints = 0;
                    this.lastMoveDown = this.time;
                }
                if (moveData.placePiece) {
                    const numLinesCleared = this.placePiece();
                    this.score += this.pushDownPoints;
                    this.pushDownPoints = 0;

                    if (numLinesCleared == 3)
                        this.addSound('tritris');
                    else if (numLinesCleared > 0) {
                        this.addSound('clear');
                    }
                }
                this.redraw = true;
            }
        }
        //Move down based on timer
        const shouldMoveDown = gravity && this.time >= this.lastMoveDown + this.pieceSpeed;
        if (this.currentPiece !== null && shouldMoveDown) {
            const moveData = this.movePiece(0, 0, true);
            this.pushDownPoints = 0;
            this.lastMoveDown = this.time;
            if (moveData.placePiece) {
                this.placePiece();
            }
            this.redraw = true;
        }
    }

    getGameState() {
        return new GameState(this);
    }

    shouldIncreaseLevel() {
        if (this.level == this.startLevel) {
            //This formula is from https://tetris.wiki/Tetris_(NES,_Nintendo)
            if (this.lines >= (this.startLevel + 1) * 10 || this.lines >= Math.max(100, this.startLevel * 10 - 50)) {
                return true;
            }
        } else {
            //If the tens digit increases (Ex from 128 to 131)
            const prevLineAmt = Math.floor((this.lines - this.animatingLines.length) / 10);
            const newLineAmt = Math.floor(this.lines / 10);
            if (newLineAmt > prevLineAmt) return true;
        }
        return false;
    }

    shouldSpawnPiece() {
        return this.currentPiece == null &&
                this.time > this.spawnNextPiece &&
                this.time > this.animatingUntil;
    }

    placePiece() {
        this.grid.addPiece(this.currentPiece);
        const row = this.currentPiece.getBottomRow();

        //Only clear lines if the next piece is not a triangle, or the next piece is a triangle, but it is a new triplet
        let numLinesCleared = 0;
        if (!this.piecesJSON[this.nextPieceIndex].hasOwnProperty('count') || //The next piece comes out once (a new sequence is starting)
            this.nextPieceCount === this.piecesJSON[this.nextPieceIndex].count) { //A new sequence is starting
            numLinesCleared = this.clearLines(); //Clear any complete lines
        }

        const entryDelay = this.calcEntryDelay(row);
        this.spawnNextPiece = this.time + entryDelay;

        this.currentPiece = null; //There is an entry delay for the next piece
        return numLinesCleared;
    }

    spawnPiece() {
        if (this.bag.length == []) {
            for (let i = 0; i < this.piecesJSON.length; i++) {
                this.bag.push(i); //Refill the bag with each piece
            }
        }
        this.currentPiece = this.nextPiece; //Assign the new current piece
        this.nextPieceCount--; //Used up one of the next pieces

        if (this.nextPieceCount <= 0) {
            //Pick a new next piece
            const bagIndex = this.gen.range(this.bag.length);
            this.numGens++;
            this.nextPieceIndex = this.bag.splice(bagIndex, 1)[0]; //Pick 1 item and remove it from bag
            const nextPieceJSON = this.piecesJSON[this.nextPieceIndex];
            if (nextPieceJSON.hasOwnProperty('count')) {
                this.nextPieceCount = nextPieceJSON.count;
            } else {
                this.nextPieceCount = 1;
            }
        } else {
            //Keep using the same next piece
        }

        this.nextPiece = new Piece(this.piecesJSON[this.nextPieceIndex], this.w);
    }

    updateScoreAndLevel() {
        //After a line clear animation has just been completed
        //Readjust the entry delay to accommodate for the animation time
        this.spawnNextPiece += this.maxAnimationTime;
        this.lines += this.animatingLines.length;

        //Increase the level after a certain amt of lines, then every 10 lines
        let playSound = false;
        if (this.shouldIncreaseLevel()) {
            this.level++;
            playSound = true;
            this.setSpeed();
        }
        this.score += this.scoreWeights[this.animatingLines.length] * (this.level + 1);
        if (this.animatingLines.length == 3)
            this.tritrisAmt++;

        for (const row of this.animatingLines) {
            this.grid.removeLine(row);
        }
        this.animatingLines = [];
        return playSound;
    }

    clearLines() {
        let linesCleared = this.grid.clearLines();
        if (linesCleared.length > 0) {
            //Set the time for when to stop animating
            this.animatingUntil = this.time + this.maxAnimationTime;
            this.animatingLines = linesCleared; //Which lines are being animated (and cleared)
        }
        return linesCleared.length;
    }

    playLineClearingAnimation() {
        const percentDone = (this.animatingUntil - this.time) / this.maxAnimationTime;
        const clearingCol = Math.floor(percentDone * this.w);
        for (const row of this.animatingLines) {
            //Clear as many cols as necessary
            for (let col = this.w; col >= clearingCol; col--) {
                //Clear from middle to left (triangle by traingle)
                const colPos = Math.floor(col / 2);
                if (col % 2 == 1) this.grid.removeRightTri(row, colPos);
                else this.grid.removeLeftTri(row, colPos);

                //Clear from middle to right
                const otherColPos = this.w - 1 - colPos;
                if (col % 2 == 0)
                    this.grid.removeRightTri(row, otherColPos);
                else this.grid.removeLeftTri(row, otherColPos);
            }
        }
        this.redraw = true;
    }

    addSound(s) {
        //Do nohing. Sounds aren't played on the server
    }

    setSpeed() {
        let lvl = this.level;
        if (this.level > 29) lvl = 29;
        if (this.level < 0) lvl = 0;
        while (true) {
            if (this.levelSpeeds.hasOwnProperty(lvl)) {
                this.pieceSpeed = this.levelSpeeds[lvl];
                break;
            } //Finds the correct range for the level speed
            lvl--;
            if (lvl < 0) {
                //Uh oh, something went wrong
                console.error('Level Speed could not be found!');
                break;
            }
        }
    }

    movePiece(horzDirection, rotation, moveDown) {
        //Apply all transformations
        const vertDirection = moveDown ? 1 : 0;
        this.currentPiece.move(horzDirection, vertDirection);
        if (rotation == -1) this.currentPiece.rotateLeft();
        if (rotation == 1) this.currentPiece.rotateRight();
        if (rotation == 2) this.currentPiece.rotate180();

        //Try with all transformations
        let valid = this.isValid(this.currentPiece);
        if (valid) {
            //The piece (possibly) moved horizontally, rotated and moved down
            return {
                placePiece: false, //Don't place the piece
                playSound: (horzDirection != 0 || rotation != 0),
                rotated: (rotation != 0),
                chargeDas: false
            }
        }
        //If blocked, undo horz move and maybe wall-charge
        this.currentPiece.move(-horzDirection, 0);
        valid = this.isValid(this.currentPiece);
        if (valid) {
            //If the piece was block when moving horz, then wall charge
            return {
                placePiece: false,
                playSound: (rotation != 0),
                rotated: (rotation != 0),
                chargeDas: true
            }
        }

        //If not valid, undo rotation
        if (rotation == 1) this.currentPiece.rotateLeft();
        if (rotation == -1) this.currentPiece.rotateRight();
        if (rotation == 2) this.currentPiece.rotate180();
        valid = this.isValid(this.currentPiece);
        if (valid) {
            //The piece was blocked by rotating
            return {
                placePiece: false, //Don't place the piece
                playSound: false,
                rotated: false,
                chargeDas: (horzDirection != 0),
            }
        }

        //If it reaches here, the piece was blocked by moving down and should be placed
        if (moveDown) this.currentPiece.move(0, -1); //Move the piece back up
        //The extra if statement is incase the pieces are at the top and spawn in other pieces
        return {
            placePiece: true, //Place the piece
            playSound: false,
            rotated: false,
            chargeDas: false
        }
    }

    calcEntryDelay(y) {
        if (y >= 18) return this.entryDelays[0];
        if (y >= 14) return this.entryDelays[1];
        if (y >= 10) return this.entryDelays[2];
        if (y >= 6) return this.entryDelays[3];
        return this.entryDelays[4];
    }

    isValid(piece) {
        if (piece.outOfBounds(this.w, this.h)) return false;
        return this.grid.isValid(piece);
    }
}

class GameState {
    constructor(game) {
        this.w = game.w;
        this.h = game.h;
        this.serializedGrid = game.grid.serialized();
        this.tritrisAmt = game.tritrisAmt;
        this.time = game.time;

        this.seed = game.seed;
        this.numGens = game.numGens;

        this.alive = game.alive;

        this.level = game.level;
        this.lines = game.lines;
        this.score = game.score;
        this.currentPieceSerialized = null;
        if (game.currentPiece) this.currentPieceSerialized = game.currentPiece.serialized();
        this.nextPiece = game.nextPiece;
        this.nextPieceIndex = game.nextPieceIndex;
        this.nextPieceCount = game.nextPieceCount;
        this.bag = [...game.bag]; //Save a copy of the current bag

        this.pieceSpeed = game.pieceSpeed;
        this.pushDownPoints = game.pushDownPoints;
        this.lastMoveDown = game.lastMoveDown;

        this.spawnNextPiece = game.spawnNextPiece;
        this.animatingUntil = game.animatingUntil;
        this.animatingLines = [...game.animatingLines];

        this.doneInputId = game.doneInputId;
    }
}

export class Input {
    constructor(id, time, horzDir, vertDir, rot, softDrop) {
        this.id = id;
        this.time = time;
        this.horzDir = horzDir;
        this.vertDir = vertDir;
        this.rot = rot;
        this.softDrop = softDrop;
    }

    encode() {
        return {
            id: this.id,
            time: this.time, //TODO encode the direction using bits to be much more compact
            horzDir: this.horzDir,
            vertDir: this.vertDir,
            rot: this.rot,
            softDrop: this.softDrop
            //dir: this.horzDir + ',' + this.vertDir + ',' + this.rot
        }
    }

    static decode(data) {
        return new Input(data.id, data.time, data.horzDir, data.vertDir, data.rot, data.softDrop);
    }

    static isValid(inp) {
        if (!inp.hasOwnProperty('id') ||
            !inp.hasOwnProperty('time') ||
            !inp.hasOwnProperty('horzDir') ||
            !inp.hasOwnProperty('vertDir') ||
            !inp.hasOwnProperty('rot') ||
            !inp.hasOwnProperty('softDrop')) return false;
        if (!inp.hasOwnProperty('time') || inp.time < 0) return false;
        if (inp.horzDir !== 0 && inp.horzDir !== -1 && inp.horzDir !== 1) return false;
        if (inp.vertDir !== false && inp.vertDir !== true) return false;
        if (inp.rot !== 0 && inp.rot !== -1 && inp.rot !== 1 && inp.rot !== 2) return false;
        if (inp.softDrop !== false && inp.softDrop !== true) return false;

        return true;
    }
}
