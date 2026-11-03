const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { default: workerScript } = require('../lib/workerScript');

const PATHFINDER_PROPERTIES = [
    'allowSprinting',
    'allowParkour',
    'canDig',
    'canOpenDoors',
    'allow1by1towers',
    'allowDiagonal',
    'allowFreeMotion',
    'allowEntityDetection',
    'dontCreateFlow',
    'maxDropDown',
    'liquidCost',
];

function addPathFinder(bot) {
    bot.loadPlugin(pathfinder);
    const defaultMove = new Movements(bot);
    const appSettings = workerScript.appSettings || {};

    for (const prop of PATHFINDER_PROPERTIES) {
        const val = appSettings[`pathfinder_${prop}`];
        if (val !== undefined) {
            // Preserves number types automatically based on default Movements schema
            defaultMove[prop] = typeof defaultMove[prop] === 'number' ? Number(val) : val;
        }
    }

    bot.pathfinder.setMovements(defaultMove);
}

module.exports = addPathFinder;