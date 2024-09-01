#!/bin/bash

# ScanMon Pre-initializer Script
# This script checks and sets up the necessary directories and permissions for ScanMon

# Check if running with sudo
if [ "$EUID" -ne 0 ]; then
  echo "Please run this script with sudo privileges"
  exit 1
fi

# Define the directories
DIRS=(
  "/opt/homebrew/etc"
  "/opt/homebrew/var/lib/clamav"
  "/opt/homebrew/var/log"
)

# Get the user who invoked sudo
SUDO_USER=$(logname)

# Function to create directory and set permissions
setup_dir() {
  local dir=$1
  if [ ! -d "$dir" ]; then
    echo "Creating directory: $dir"
    mkdir -p "$dir"
  else
    echo "Directory already exists: $dir"
  fi
  
  echo "Setting ownership of $dir to $SUDO_USER"
  chown -R "$SUDO_USER" "$dir"
  
  echo "Setting permissions for $dir"
  chmod -R 755 "$dir"
}

# Main execution
echo "Starting ScanMon pre-initialization..."

for dir in "${DIRS[@]}"; do
  setup_dir "$dir"
done

echo "Pre-initialization complete. Directories are set up and permissions are corrected."
echo "You can now run the ScanMon application."
