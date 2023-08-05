const { ipcRenderer } = require('electron');

// Function to open folder dialog
function chooseFolder() {
    ipcRenderer.send('openFolderDialog');
}

// Function to update the status in the interface
function updateStatus(status) {
    const statusLabel = document.getElementById('statusLabel');
    if(status === 'Err 403 Google API Temporary banned!') {
        statusLabel.style.color = 'red';
    }else {
        statusLabel.style.color = '#fff';
    }

    statusLabel.textContent = status;
}

ipcRenderer.on('subfoldersFetched', (event, subfolders) => {
    populateVersionSelector(subfolders);
});

function populateVersionSelector(subfolders) {
    const versionSelector = document.getElementById('version-selector');

    // Clear out any existing options
    while (versionSelector.firstChild) {
        versionSelector.removeChild(versionSelector.firstChild);
    }

    // Add each subfolder as an option in reverse order
    for (let i = subfolders.length - 1; i >= 0; i--) {
        const folder = subfolders[i];
        const option = document.createElement('option');
        option.value = folder.name;
        option.textContent = folder.name;
        versionSelector.appendChild(option);
    }
    updateSelectedFolder();
}
function updateSelectedFolder() {
    const selectedFolderId = document.getElementById('version-selector').value;
    const selectedFolderName = document.getElementById('version-selector').options[document.getElementById('version-selector').selectedIndex].text;
    ipcRenderer.send('selectedFolderId', selectedFolderId, selectedFolderName);
}

// When the selected option in the version selector changes, send the new selected folder ID to the main process
document.getElementById('version-selector').addEventListener('change', updateSelectedFolder);





// Function to send a request to update files
function updateFiles() {
    // Before sending the request, check if a folder path is selected
    const selectedFolderPathInput = document.getElementById('selectedFolderPath');
    if (selectedFolderPathInput.value.trim() === "") {
        // If no folder path is selected, show the notification and do not send the request
        document.getElementById('folderNotification').style.display = 'block';
        return;
    }
    // If a folder path is selected, hide the notification and send the request
    document.getElementById('folderNotification').style.display = 'none';
    ipcRenderer.send('updateFiles');
}
function setButtonDisabledState(disabled) {
    const installButton = document.getElementById('install-button');
    installButton.disabled = disabled;
    const chooseFolderButton = document.getElementById('sc2-path-select');
    chooseFolderButton.disabled = disabled;
    const versionSelector = document.getElementById('version-selector');
    versionSelector.disabled = disabled;
}

// Listener to receive the selected folder path from the main process
ipcRenderer.on('folderSelected', (event, folderPath) => {
    const selectedFolderPathInput = document.getElementById('selectedFolderPath');
    selectedFolderPathInput.value = folderPath;
});

// Listener to handle responses from the main process (main.js)
ipcRenderer.on('updateStatus', (event, status) => {
    updateStatus(status);
});
let buttonTextInterval;

ipcRenderer.on('buttonText', (event, text, animation) => {
    const installButton = document.getElementById('install-button');
    installButton.textContent = `${text}`;

    if (!animation) {
        clearInterval(buttonTextInterval);
        return;
    }
    let dots = 0;
    buttonTextInterval = setInterval(() => {
        installButton.textContent = `${text}` + '.'.repeat(dots);
        dots = (dots + 1) % 4;
    }, 750);  // Update every 3/4 a second
});

ipcRenderer.on('stopButtonTextAnimation', (event, text) => {
    clearInterval(buttonTextInterval);
    const installButton = document.getElementById('install-button');
    installButton.textContent = `${text}`;
});

ipcRenderer.on('downloadProgress', (event, { progress, downloaded, total }) => {
    const progressBar = document.getElementById('progressBar');
    const progressLabel = document.getElementById('progressLabel');
    const progressContainer = document.getElementById('overall-progress');
    const downloadedGB = (downloaded / (1024 * 1024 * 1024)).toFixed(2);
    const totalGB = (total / (1024 * 1024 * 1024)).toFixed(2);
    if (progress === -1) {
        progressLabel.textContent = `Error downloading`;
    } else if (progress <100){
        progressLabel.textContent = `${downloadedGB} GB / ${totalGB} GB   (${progress.toFixed(0)}%)`;
    }

    progressBar.value = progress;

    // Show/hide the progress bar and status label based on download progress
    if (progress === 0) {
        progressContainer.style.display = 'none'; // Hide progress bar at the start of download
    } else if(progress !==null && progressContainer!==null) {
        progressContainer.style.display = 'contents'; // Show progress bar during download
    }

    // Hide progress bar and status label when download is complete
});
ipcRenderer.on('downloadProgressSingleFile', (event, { fileName, progress, downloadedBytes, totalSizeBytes }) => {
    let fileProgressContainer = document.getElementById(`fileProgress_${fileName}`);

    // If we don't have an element for this file yet, create it.
    if (!fileProgressContainer) {
        fileProgressContainer = document.createElement('div');
        fileProgressContainer.id = `fileProgress_${fileName}`;
        fileProgressContainer.className = 'single-file-progress';
        fileProgressContainer.innerHTML = `
        <div class="progress-label">
            <span id="fileName_${fileName}" class="file-name">${fileName}</span>
        </div>
        <div class="progress-container">
            <div class="progress-info">
                <span id="fileSize_${fileName}" class="file-size">0 MB/0 MB</span>
                <span id="progressPercent_${fileName}" class="file-progress-percent">0%</span>
            </div>
            <progress id="progressBar_${fileName}" value="0" max="100"></progress>
        </div>
    `;

        // Add the file progress bar to the files progress container
        document.getElementById('filesProgressContainer').appendChild(fileProgressContainer);
    }
    // Update the file's progress bar
    const fileProgressBar = document.getElementById(`progressBar_${fileName}`);
    fileProgressBar.value = progress;

    // Update the file size
    const fileSize = document.getElementById(`fileSize_${fileName}`);
    const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(0); // convert bytes to megabytes
    const totalMB = (totalSizeBytes / (1024 * 1024)).toFixed(0); // convert bytes to megabytes
    fileSize.innerHTML = `${downloadedMB} MB / ${totalMB} MB`;

    // Update the progress percentage
    const fileProgressPercent = document.getElementById(`progressPercent_${fileName}`);
    fileProgressPercent.innerHTML = `${progress.toFixed(0)}%`;

    if(fileProgressBar.value === 100 && fileProgressBar.style.display !== 'none'){
        fileProgressBar.style.display = 'none'; // hide progress bar
        fileSize.style.display = 'none'; // hide file size label
        fileProgressPercent.style.display = 'none'; // hide file progress percent label

        let checkmark = document.createElement('div');
        checkmark.textContent = '✓'; // set the text content to a checkmark
        checkmark.style.color = 'green'; // color the checkmark green
        checkmark.style.fontSize = '1em'; // adjust as needed
        fileProgressContainer.appendChild(checkmark); // add the checkm
    }
});
ipcRenderer.on('clean', (event, start) => {
    // Remove all file progress bars
    if(start){
        const progressBar = document.getElementById('progressBar');
        const progressLabel = document.getElementById('progressLabel');
        progressBar.value = 0;
        progressLabel.textContent = '';
        //show the overall progress bar

        setButtonDisabledState(true);
        const gameInput= document.getElementById('selectedFolderPath');
        gameInput.style.color = '#6c6c6c';
        document.getElementById('filesProgressContainer').innerHTML = '';
        updateStatus('');

    }else {
        setButtonDisabledState(false);
        const progressBar = document.getElementById('progressBar');
        const progressLabel = document.getElementById('progressLabel');
        progressBar.value = 0;
        progressLabel.textContent = '';
        //Hide the overall progress bar
        const progressContainer = document.getElementById('overall-progress');
        progressContainer.style.display = 'none';

        const gameInput= document.getElementById('selectedFolderPath');
        gameInput.style.color = '#fff';
    }



});


ipcRenderer.send('getFileStructure');
ipcRenderer.send('loadSavedFolderPath');