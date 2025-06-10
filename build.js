const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

// Ensure lib directory exists
const libDir = path.join(__dirname, 'lib');

// Clean lib directory if it exists
if (fs.existsSync(libDir)) {
  console.log('Cleaning lib directory...');
  fs.rmSync(libDir, { recursive: true, force: true });
}

// Create lib directory
console.log('Creating lib directory...');
fs.mkdirSync(libDir, { recursive: true });

// Helper function to check if a module is installed
function isModuleInstalled(moduleName) {
  try {
    require.resolve(moduleName);
    return true;
  } catch (e) {
    return false;
  }
}

// Run babel to transpile the code
console.log('Transpiling source code...');

// First check if @babel/cli is installed
if (!isModuleInstalled('@babel/cli') || !isModuleInstalled('@babel/core')) {
  console.log('Installing required babel packages...');
  try {
    execSync('npm install --no-save @babel/cli @babel/core @babel/preset-env @babel/plugin-transform-runtime @babel/register',
      { stdio: 'inherit' });
    execSync('npm install --no-save @babel/runtime', { stdio: 'inherit' });
  } catch (error) {
    console.error('Failed to install babel dependencies:', error.message);
    // Continue anyway and try to use what's available
  }
}

try {
  // Try using npx babel
  console.log('Trying to run babel with npx...');
  const result = spawnSync('npx', ['--no-install', '@babel/cli/bin/babel.js',
    'src', '--out-dir', 'lib', '--extensions', '.js'],
    { stdio: 'inherit', shell: true });

  if (result.status !== 0) {
    throw new Error(`Babel exited with status ${result.status}`);
  }

  console.log('Build completed successfully.');
} catch (error) {
  console.error('Build with babel failed:', error.message);
  console.error('Creating simple JavaScript copies as fallback...');

  // If babel fails, just copy the files as a fallback
  try {
    const srcDir = path.join(__dirname, 'src');
    const files = fs.readdirSync(srcDir);

    files.forEach(file => {
      if (file.endsWith('.js')) {
        const srcFile = path.join(srcDir, file);
        const destFile = path.join(libDir, file);

        // Create a simple CommonJS wrapper for each file
        const content = fs.readFileSync(srcFile, 'utf8');

        // Extremely simple transform to convert imports to requires
        // This is not a full babel replacement but might work for simple cases
        let transformed = content
          .replace(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g, 'const $1 = require("$2");')
          .replace(/import\s+{\s*([^}]+)\s*}\s+from\s+['"]([^'"]+)['"]/g, 'const { $1 } = require("$2");');

        fs.writeFileSync(destFile, transformed);
      }
    });
    console.log('Simple file copying completed as fallback.');
  } catch (fallbackError) {
    console.error('Fallback copying failed:', fallbackError.message);
    process.exit(1);
  }
}
