// Function to trigger garbage collection
async function triggerGarbageCollection() {
    if (global.gc) {
        global.gc();
        console.log("\nGarbage collection triggered.");
    } else {
        console.warn("Garbage collection is not enabled. Run the script with --expose-gc.");
    }
}

module.exports = {
    triggerGarbageCollection,
}