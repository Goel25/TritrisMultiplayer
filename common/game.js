const { Grid, GridCell, Triangle, Piece } = require('./classes.js');
const RandomGenerator = require('random-seed');
const piecesJSON = require('./pieces.js');


/* TODO
 *
 * TEST ON ACTUAL SERVER!!!
 *
 *  Rename timer variables
 *  Remove extra variables
 *  Fix number of points for double (should be 300)
 *  Make push down points consistent
 *  Figure out deltaTime stuff
 *  Make server more authoritative. Validate inputs, ensure piece falls consistently
 *  Add redraw
 *  Look into obfuscating client side code (https://www.npmjs.com/package/javascript-obfuscator)
 *  Fix in game timer display
 *  Add graphics
 *
 * DONE
 *  Add line clears
 *  Add RNG
 *  Clean up reset code (the same variables being set in Game constructor, goToStart and ClientGame gotData)
 *  Add second player
 */

class Game {
    constructor(level=9, seed = 'abc123') {
        this.w = 8;
        this.h = 16;
        this.grid = new Grid(this.w, this.h);

        this.tritrisAmt = 0; //For statistics
        this.startTime = Date.now();
        this.time = 0;

        this.seed = seed;
        this.gen = new RandomGenerator(this.seed);
        this.numGens = 0; //Used to know how many steps to advance the rng from the initial state when the client recieves an update

        this.alive = true;

        if (level < 0) level = 0;
        if (level > 29) level = 29;
        if (level >= 20 && level <= 28) level = 19; //Can only start on 0-19 or 29
        this.startLevel = level;
        this.level = level;
        this.lines = 0;
        this.score = 0;
        this.scoreWeights = { 1: 100, 2: 400, 3: 1200 };
        //TODO The weights should be 1: 100, 2: 300, 3: 1200!!!!!!!!!!!!!!

        //this.piecesType = 3; //How many triangles are in each piece
        //if (piecesJSON.pieces.length > 7) this.piecesType = 4; //Quadtris

        this.piecesJSON = piecesJSON;

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
        this.currentPieceIndex = null;
        this.nextPiece = null; //The next piece starts as a random piece that isn't a single triangles
        this.nextPieceIndex = null;
        this.nextSingles = 0;
        this.bag = [];
        this.spawnPiece(); //Sets the next piece
        this.firstPieceIndex = this.nextPieceIndex; //Used for saving games
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

        this.softDropSpeed = msPerFrame * 2;
        this.pushDownPoints = 0;
        this.softDropAccuracy = 18; //Bc of inconsistent framerate, soft drop speed may vary. This accounts for that
        this.lastMoveDown = this.time + 750;

        this.lastFrame = Date.now(); //Used to calculate deltaTime and for DAS
        //TODO This is unnecessary in the server

        this.spawnNextPiece = 0;

        this.animationTime = 0;
        this.animatingLines = [];
        this.maxAnimationTime = 20 * msPerFrame;
        this.maxFlashTime = 20 * msPerFrame;
        this.flashTime = 0;
        this.flashAmount = 4;

        this.inputs = [];
        this.doneInputId = -1; //The higheset input id that has been completed
        this.latestState = new GameState(this); //The game state with the highest input id completed

        this.initialGameState = new GameState(this);
    }

    goToStart() { //Resets the game so it can be replayed up to any time necessary
        this.goToGameState(this.initialGameState);
    }

    goToGameState(state) {
        this.seed = state.seed;
        this.gen = new RandomGenerator(this.seed);
        this.numGens = state.numGens;
        for (let i = 0; i < this.numGens; i++)
            this.gen.range(1); //Advance the internal state of the random number generator to match

        this.bag = [...state.bag];
        this.nextSingles = state.nextSingles;

        if (state.currentPieceSerialized) this.currentPiece = new Piece(state.currentPieceSerialized);
        else this.currentPiece = null;

        this.nextPieceIndex = state.nextPieceIndex;
        if (this.nextPieceIndex !== null) this.nextPiece = new Piece(this.piecesJSON[this.nextPieceIndex]);
        else this.nextPiece = null;

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
        this.animationTime = state.animationTime;
        this.animatingLines = state.animatingLines;
        this.flashTime = state.flashTime;

        this.time = state.time;

        //this.updateToTime(Date.now() - this.startTime); //Recatch-up the game
        this.lastFrame = Date.now();
    }

    updateFromStartToTime(t, gravity) {
        this.goToStart(); //TODO Don't go to start every time. Instead, save the game state every ~10 seconds and reset to there
        this.updateToTime(t, gravity);
    }

    updateToTime(t, gravity) { //Go from the current time to t and do all inputs that happened during that time
        if (this.time > t) {
            console.log('Cannot go backwards to ' + t);
        }
        let nextInputId = this.inputs.length; //The id of the next input that should be played. If none should be played, it will be inputs.length

        for (let i = 0; i < this.inputs.length; i++) {
            if (this.inputs[i].time > this.time) {
                nextInputId = i; //Find which input has not been played yet
                break;
            }
        }

        while (this.time < t) {
            //TODO Make deltaTime softDropSpeed??? Currently, any soft drops will be an Input and the nextInput algorithm will jump to them. What if the user doesn't send inputs though?
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
        this.lastFrame = Date.now();

        this.time += deltaTime;
        //if (!this.alive) return;

        //Play a line clear animation
        if (this.time <= this.animationTime) {
            //Line clear animation. Not needed on server
        } else if (this.animatingLines.length > 0) {
            this.updateScoreAndLevel(); //After a line clear, update score and level and removed the lines from the grid
        }

        //Spawn the next piece after entry delay
        if (this.shouldSpawnPiece()) {
            this.spawnPiece();
            this.lastMoveDown = this.time;
            if (!this.isValid(this.currentPiece)) {
                this.alive = false; //If the new piece is already blocked, game over
            }
        }

        //Piece Movement
        //TODO Figure out how to make this whole thing a while loop. Or just don't increase deltaTime if inputs are being played...
        if (this.currentPiece !== null) {
            if (input) { //It is time for the input to be performed
                const moveData = this.movePiece(input.horzDir, input.rot, input.vertDir);
                if (input.vertDir) {
                    const timeSinceLastMoveDown = this.time - this.lastMoveDown;
                    const diffFromSoftDrop = Math.abs(timeSinceLastMoveDown - this.softDropSpeed);
                    if (diffFromSoftDrop <= this.softDropAccuracy && this.level < 19) { //20ms is an arbitrary number because of inconsistent frame rate
                        this.pushDownPoints++; //Pushing down
                    } else {
                        this.pushDownPoints = 0;
                    }
                    this.lastMoveDown = this.time;
                }
                if (moveData.placePiece) {
                    this.placePiece();
                    this.score += this.pushDownPoints;
                    this.pushDownPoints = 0;

                    //this.lastMoveDown = this.time; //TODO This is unnecessary?
                }
            } //TODO Once client prediction is implemented, figure out the ordering of playing inputs and moving pieces. What if something happens at the same time?
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
                this.time > this.animationTime;
    }

    placePiece() {
        this.grid.addPiece(this.currentPiece);
        const row = this.currentPiece.getBottomRow();

        //Only clear lines if the next piece is not a triangle, or the next piece is a triangle, but it is a new triplet
        if (this.nextPieceIndex != 0 || this.nextSingles == 2) {
            this.clearLines(); //Clear any complete lines
        }

        const entryDelay = this.calcEntryDelay(row);
        this.spawnNextPiece = this.time + entryDelay;

        this.currentPiece = null; //There is an entry delay for the next piece
    }

    spawnPiece() {
        if (this.bag.length == []) {
            for (let i = 0; i < this.piecesJSON.length; i++) {
                this.bag.push(i); //Refill the bag with each piece
            }
        }
        this.currentPiece = this.nextPiece; //Assign the new current piece
        this.currentPieceIndex = this.nextPieceIndex; //TODO This will be out of sync on the client. It shouldn't matter though
        if (this.nextSingles > 0) {
            this.nextPieceIndex = 0; //This will make it spawn 3 single triangles in a row
            this.nextSingles--;
        } else {
            const bagIndex = this.gen.range(this.bag.length);
            this.numGens++;
            this.nextPieceIndex = this.bag.splice(bagIndex, 1)[0]; //Pick 1 item and remove it from bag
            if (this.nextPieceIndex == 0) {
                //If it randomly chose to spawn 1 triangle, spawn 2 more
                this.nextSingles = 2;
            }
        }

        //this.currentSnapshot.setNext(this.nextPieceIndex);
        this.nextPiece = new Piece(this.piecesJSON[this.nextPieceIndex]);
    }

    updateScoreAndLevel() {
        //After a line clear animation has just been completed
        //Readjust the entry delay to accommodate for the animation time
        this.spawnNextPiece += this.maxAnimationTime;
        this.lines += this.animatingLines.length;

        //Increase the level after a certain amt of lines, then every 10 lines
        if (this.shouldIncreaseLevel()) {
            this.level++;
            this.setSpeed();
        }
        this.score += this.scoreWeights[this.animatingLines.length] * (this.level + 1);
        if (this.animatingLines.length == 3)
            this.tritrisAmt++;

        for (const row of this.animatingLines) {
            this.grid.removeLine(row);
        }
        this.animatingLines = [];
    }

    clearLines() {
        let linesCleared = this.grid.clearLines();
        if (linesCleared.length > 0) {
            //Set the time for when to stop animating
            this.animationTime = this.time + this.maxAnimationTime;
            this.animatingLines = linesCleared; //Which lines are being animated (and cleared)
            if (linesCleared.length == 3) {
                //Tritris!
                this.flashTime = this.time + this.maxFlashTime;
            }
        }
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
        this.startTime = game.startTime; //TODO This might be unnecessary
        this.time = game.time;

        this.seed = game.seed;
        this.numGens = game.numGens;

        this.alive = game.alive;

        this.level = game.level;
        this.lines = game.lines;
        this.score = game.score;
        this.currentPieceSerialized = null;
        if (game.currentPiece) this.currentPieceSerialized = game.currentPiece.serialized();
        this.currentPieceIndex = game.currentPieceIndex;
        this.nextPiece = game.nextPiece; //TODO Maybe rework how next piece is serialized. Rotations and pos don't matter though
        this.nextPieceIndex = game.nextPieceIndex;
        this.nextSingles = game.nextSingles;
        this.bag = [...game.bag]; //Save a copy of the current bag

        this.pieceSpeed = game.pieceSpeed;
        this.pushDownPoints = game.pushDownPoints;
        this.lastMoveDown = game.lastMoveDown;

        this.spawnNextPiece = game.spawnNextPiece;
        this.animationTime = game.animationTime;
        this.animatingLines = game.animatingLines;
        this.flashTime = game.flashTime;

        this.doneInputId = game.doneInputId;
    }

    serialize() { //TODO This isn't used
        return this;
    }
}

class Input {
    constructor(id, time, horzDir, vertDir, rot) {
        this.id = id;
        this.time = time;
        this.horzDir = horzDir;
        this.vertDir = vertDir;
        this.rot = rot;
    }

    encode() {
        return {
            id: this.id,
            time: this.time, //TODO encode the direction using bits to be much more compact
            horzDir: this.horzDir,
            vertDir: this.vertDir,
            rot: this.rot
            //dir: this.horzDir + ',' + this.vertDir + ',' + this.rot
        }
    }

    static decode(data) {
        return new Input(data.id, data.time, data.horzDir, data.vertDir, data.rot);
    }
}

module.exports = { Game, Input };
