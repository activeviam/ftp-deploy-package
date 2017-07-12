'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const promisify = require('es6-promisify');
const execa = require('execa');
const fse = require('fs-extra');
const recursiveReadDir = require('recursive-readdir');

const {name: packageName} = require('./package.json');
const {
  copySourceFiles,
  createFtpClient,
  getLeaveDirectories,
  normalizePathToLinux,
} = require('./utils');

const mkdtemp = promisify(fs.mkdtemp);

const defaultHandlers = {
  beforeClosingConnection() {
    return Promise.resolve();
  },
  beforeUpload() {
    return Promise.resolve();
  },
  onFileUploaded() {},
  onStatusUpdate() {},
};

const ftpDeployPackage = (packageDirectory, ftpConfig, handlers = {}) => {
  const {
    beforeClosingConnection,
    beforeUpload,
    onFileUploaded,
    onStatusUpdate: updateStatus,
  } = Object.assign(defaultHandlers, handlers);

  updateStatus(`starting deployment of ${packageDirectory}`);

  const createDeploymentDirectory = mkdtemp(
    path.join(os.tmpdir(), `${packageName}-`)
  ).then(deploymentDirectory => {
    updateStatus(`deployment directory ${deploymentDirectory} created`);
    return deploymentDirectory;
  });

  const copySourceFilesToDeploymentDirectory = createDeploymentDirectory.then(
    deploymentDirectory =>
      copySourceFiles(packageDirectory, deploymentDirectory)
  );

  const getFilesToUpload = copySourceFilesToDeploymentDirectory.then(
    ({directory: packageDeploymentDirectory, filePaths: sourceFilePaths}) => {
      updateStatus('installing npm dependencies');
      return execa('npm', ['install', '--production', '--no-package-lock'], {
        cwd: packageDeploymentDirectory,
      })
        .then(() =>
          recursiveReadDir(
            path.join(packageDeploymentDirectory, 'node_modules')
          )
        )
        .then(nodeModulesFiles =>
          nodeModulesFiles
            // eslint-disable-next-line no-sync
            .filter(filePath => fs.lstatSync(filePath).isFile())
            .map(filePath =>
              path.relative(packageDeploymentDirectory, filePath)
            )
        )
        .then(usefulNodeModulesFile =>
          sourceFilePaths.concat(usefulNodeModulesFile)
        )
        .then(filePaths => filePaths.map(normalizePathToLinux));
    }
  );

  const ftpConnect = Promise.resolve().then(() => {
    const client = createFtpClient();

    const res = client.on('ready').then(() => {
      updateStatus('FTP connection established');
      return client;
    });

    client.connect(ftpConfig);

    return res;
  });

  const upload = Promise.all([
    createDeploymentDirectory,
    copySourceFilesToDeploymentDirectory,
    getFilesToUpload,
    ftpConnect,
  ]).then(
    (
      [
        deploymentDirectory,
        {directory: packageDeploymentDirectory},
        filesToUpload,
        ftpClient,
      ]
    ) => {
      updateStatus('preparing remote directory structure');

      const remotePath = ftpConfig.path;
      const remoteDirectory = path.basename(remotePath);
      const leaveDirectories = getLeaveDirectories(filesToUpload);

      return ftpClient
        .cwd(path.dirname(remotePath))
        .then(() => ftpClient.rmdir(remoteDirectory, true))
        .then(() => ftpClient.mkdir(remoteDirectory))
        .then(() => ftpClient.cwd(remoteDirectory))
        .then(() =>
          Promise.all(
            leaveDirectories.map(directory => ftpClient.mkdir(directory, true))
          )
        )
        .then(() => beforeUpload(ftpClient, filesToUpload))
        .then(() => {
          updateStatus('uploading');
          return Promise.all(
            filesToUpload.map(filePath =>
              ftpClient
                .put(path.join(packageDeploymentDirectory, filePath), filePath)
                .then(() => {
                  onFileUploaded(filePath);
                })
            )
          );
        })
        .then(() =>
          beforeClosingConnection(ftpClient)
            .catch(err => {
              updateStatus('error while deploying');
              // eslint-disable-next-line no-console
              console.error(err);
            })
            .then(() => {
              ftpClient.end();
              return fse.remove(deploymentDirectory);
            })
        );
    }
  );

  return upload;
};

module.exports = ftpDeployPackage;
