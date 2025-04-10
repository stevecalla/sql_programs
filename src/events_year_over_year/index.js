const { exec } = require('child_process');
const path = require('path');

// const pythonScript = path.join(__dirname, 'compare_v3.py');
const pythonScript = path.join(__dirname, 'src/main.py');

// Start timer
const start = Date.now();

// Run Python script
exec(`python "${pythonScript}"`, (error, stdout, stderr) => {
  const duration = (Date.now() - start) / 1000;

  console.log(`⏳ main.py took ${duration.toFixed(2)} seconds`);

  if (error) {
    console.error('❌ Failed to run process in main.py:', error.message);
    return;
  }

  if (stderr) {
    console.error('⚠️ Python stderr:', stderr);
  }

  console.log('📄 Output from main.py:\n', stdout.trim());
});
