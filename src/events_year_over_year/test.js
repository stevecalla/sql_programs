const { exec } = require('child_process');

// Try running a simple Python command
exec('python --version', (error, stdout, stderr) => {
  if (error) {
    console.error('❌ Python is not working or not installed:', error.message);
    return;
  }

  // Check for output in stdout or stderr depending on Python version
  const output = stdout || stderr;
  console.log('✅ Python is working! Version:', output.trim());

  // Optional: Run a simple Python script
  exec('python -c "print(\'Hello from Python!\')"', (err, out, errOut) => {
    if (err) {
      console.error('❌ Error running Python code:', err.message);
    } else {
      console.log('Python says:', out.trim());
    }
  });
});
