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
  const configFile = os.platform() === 'darwin' 
    ? '/opt/homebrew/etc/clamav/clamd.conf' 
    : '/etc/clamav/clamd.conf';

  try {
    const config = await fs.readFile(configFile, 'utf8');
    if (!config.includes('TCPSocket') && !config.includes('LocalSocket')) {
      console.log("Warning: ClamAV configuration may not have TCP or Unix socket enabled.");
    }
  } catch (error) {
    console.log("Warning: ClamAV configuration file not found or inaccessible.");
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
  countFiles
};
