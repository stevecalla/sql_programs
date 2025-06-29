const { exec } = require('child_process');
const path = require('path');
const { runTimer, stopTimer } = require('../../utilities/timer');


// const pythonScript = path.join(__dirname, 'compare_v3.py');
const pythonScript = path.join(__dirname, 'src/main.py');

// Start timer
const start = Date.now();

runTimer(`get_data`);

// Run Python script
exec(`python3 "${pythonScript}"`, (error, stdout, stderr) => {
  const duration = (Date.now() - start) / 1000;

  console.log(`\n⏳ main.py took ${duration.toFixed(2)} seconds`);

  if (error) {
    console.error('❌ Failed to run process in main.py:', error.message);
    
    stopTimer(`get_data`);

    return;
  }

  if (stderr) {
    console.error('⚠️ Python stderr:', stderr);
    stopTimer(`get_data`);
  }

  console.log('📄 Output from main.py:\n', stdout.trim());
  stopTimer(`get_data`);
});
