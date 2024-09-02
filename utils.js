// utils.js
const { exec, execSync } = require('child_process');
const fs = require('fs').promises;
const util = require('util');
const os = require('os');
const path = require('path');

const execPromise = util.promisify(exec);

function checkSudo() {
  if (process.getuid && process.getuid() === 0) {
    console.log("This script should not be run with sudo. Please run it as a normal user.");
    process.exit(1);
  }
}

function checkSystemCompatibility() {
  const platform = os.platform();
  if (platform !== 'linux' && platform !== 'darwin') {
    console.log(`Unsupported operating system: ${platform}. This application is designed for Linux and macOS.`);
    process.exit(1);
  }
}

async function checkDirectoryPermissions(dir) {
  try {
    const stats = await fs.stat(dir);
    const mode = stats.mode & parseInt('777', 8);
    const owner = stats.uid;
    const currentUser = process.getuid();

    if (owner !== currentUser || (mode & parseInt('700', 8)) !== parseInt('700', 8)) {
      console.log(`Warning: Insufficient permissions for ${dir}. This may affect the scan.`);
    }
  } catch (error) {
    console.log(`Error checking permissions for ${dir}: ${error.message}`);
  }
}

async function ensureDirectories() {
  const platform = os.platform();
  const directories = platform === 'darwin' 
    ? ['/opt/homebrew/etc', '/opt/homebrew/var/lib/clamav', '/opt/homebrew/var/log']
    : ['/etc/clamav', '/var/lib/clamav', '/var/log/clamav'];

  for (const dir of directories) {
    try {
      await fs.access(dir);
      await checkDirectoryPermissions(dir);
    } catch (error) {
      console.log(`Warning: Directory ${dir} does not exist or is not accessible.`);
    }
  }
}

async function checkClamAVInstallation() {
  try {
    await execPromise('which clamscan');
    return true;
  } catch (error) {
    return false;
  }
}

async function installDependencies() {
  const platform = os.platform();
  
  if (platform === 'darwin') {
    console.log('To install ClamAV on macOS, run: brew install clamav');
  } else if (platform === 'linux') {
    console.log('To install ClamAV on Linux:');
    console.log('For Ubuntu/Debian: sudo apt-get update && sudo apt-get install -y clamav clamav-daemon');
    console.log('For Fedora/CentOS: sudo dnf install -y clamav clamav-update');
  }
  console.log('After installation, run this script again.');
  process.exit(0);
}

async function checkAndInstallDependencies() {
  const nodeDependencies = ['inquirer', 'cli-progress'];

  for (const dep of nodeDependencies) {
    try {
      require.resolve(dep);
    } catch (error) {
      console.log(`Installing ${dep}...`);
      try {
        await execPromise(`npm install ${dep}`);
      } catch (installError) {
        console.error(`Failed to install ${dep}. Please install it manually.`);
        throw installError;
      }
    }
  }

  const isClamAVInstalled = await checkClamAVInstallation();
  if (!isClamAVInstalled) {
    await installDependencies();
  }
}

async function checkClamAVConfig() {
  const platform = os.platform();
  let configFile;
  let freshclamConfigFile;

  if (platform === 'darwin') {
    configFile = '/opt/homebrew/etc/clamav/clamd.conf';
    freshclamConfigFile = '/opt/homebrew/etc/clamav/freshclam.conf';
  } else if (platform === 'linux') {
    configFile = '/etc/clamav/clamd.conf';
    freshclamConfigFile = '/etc/clamav/freshclam.conf';
  } else {
    console.log("Unsupported operating system. Cannot check ClamAV configuration.");
    return;
  }

  try {
    await fs.access(configFile, fs.constants.R_OK);
    const config = await fs.readFile(configFile, 'utf8');
    if (!config.includes('TCPSocket') && !config.includes('LocalSocket')) {
      console.log("Warning: ClamAV configuration may not have TCP or Unix socket enabled.");
    }
    console.log("ClamAV configuration file found and is accessible.");
  } catch (error) {
    console.log(`Warning: ClamAV configuration file (${configFile}) not found or inaccessible.`);
    console.log("This may indicate that ClamAV is not properly installed or configured.");
    
    if (platform === 'darwin') {
      console.log("For macOS users:");
      console.log("1. Ensure ClamAV is installed: brew install clamav");
      console.log("2. Run: sudo cp /opt/homebrew/etc/clamav/freshclam.conf.sample /opt/homebrew/etc/clamav/freshclam.conf");
      console.log("3. Edit the freshclam.conf file to uncomment the 'DatabaseMirror' line.");
      console.log("4. Run: sudo freshclam");
    } else if (platform === 'linux') {
      console.log("For Linux users:");
      console.log("1. Ensure ClamAV is installed. On Ubuntu/Debian: sudo apt-get install clamav");
      console.log("2. Check if the configuration files exist in /etc/clamav/");
      console.log("3. If not, you may need to create them or reinstall ClamAV");
    }
  }

  // Check freshclam configuration
  try {
    await fs.access(freshclamConfigFile, fs.constants.R_OK);
    console.log("Freshclam configuration file found and is accessible.");
  } catch (error) {
    console.log(`Warning: Freshclam configuration file (${freshclamConfigFile}) not found or inaccessible.`);
    console.log("This may affect the ability to update virus definitions.");
  }
}

function getVulnerableDirectories() {
  const homeDir = os.homedir();
  return {
    "System directories": [
      '/System/Library',
      '/Library',
      '/usr/lib',
      '/usr/local/lib'
    ],
    "Application directories": [
      '/Applications',
      path.join(homeDir, 'Applications')
    ],
    "Script directories": [
      '/etc/rc.d',
      '/etc/init.d',
      '/Library/StartupItems'
    ],
    "User directories": [
      path.join(homeDir, 'Downloads'),
      path.join(homeDir, 'Documents'),
      path.join(homeDir, 'Desktop')
    ],
    "Log files": [
      '/var/log'
    ]
  };
}

async function countFiles(directory) {
  let fileCount = 0;
  const items = await fs.readdir(directory, { withFileTypes: true });
  for (const item of items) {
    if (item.isDirectory()) {
      fileCount += await countFiles(path.join(directory, item.name));
    } else {
      fileCount++;
    }
  }
  return fileCount;
}

async function getDatabaseAge(dbPath) {
  try {
    const stats = await fs.stat(dbPath);
    const ageInDays = (Date.now() - stats.mtime) / (1000 * 60 * 60 * 24);
    return ageInDays;
  } catch (error) {
    console.error(`Error checking database: ${error.message}`);
    return null;
  }
}

module.exports = {
  checkSudo,
  checkSystemCompatibility,
  checkDirectoryPermissions,
  ensureDirectories,
  checkClamAVInstallation,
  installDependencies,
  checkAndInstallDependencies,
  checkClamAVConfig,
  getVulnerableDirectories,
  countFiles,
  getDatabaseAge
};
