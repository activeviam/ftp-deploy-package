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
  beforeDirectoriesCreation() {
    return Promise.resolve();
  },
  beforeUpload() {
    return Promise.resolve();
  },
  onDirectoryCreated() {},
  onFileUploaded() {},
  onStatusUpdate() {},
};

const ftpDeployPackage = (packageDirectory, ftpConfig, handlers = {}) => {
  const {
    beforeClosingConnection,
    beforeDirectoriesCreation,
    beforeUpload,
    onDirectoryCreated,
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
      const nodeModulesPath = path.join(
        packageDeploymentDirectory,
        'node_modules'
      );

      updateStatus('installing npm dependencies');

      return execa('npm', ['install', '--production', '--no-package-lock'], {
        cwd: packageDeploymentDirectory,
      })
        .then(() => fse.ensureDir(nodeModulesPath))
        .then(() => recursiveReadDir(nodeModulesPath))
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

      const operations = [
        () => ftpClient.cwd(path.dirname(remotePath)),
        () =>
          ftpClient
            .list()
            .then(list =>
              (list.some(({name}) => name === remoteDirectory)
                ? ftpClient.rmdir(remoteDirectory, true)
                : Promise.resolve()).then(() =>
                ftpClient.mkdir(remoteDirectory)
              )
            ),
        () => ftpClient.cwd(remoteDirectory),
        () => beforeDirectoriesCreation(ftpClient, leaveDirectories),
        ...leaveDirectories.map(directoryPath => () =>
          ftpClient
            .mkdir(directoryPath, true)
            .then(() => onDirectoryCreated(directoryPath))
        ),
        () => beforeUpload(ftpClient, filesToUpload),
        ...filesToUpload.map(filePath => () =>
          ftpClient
            .put(path.join(packageDeploymentDirectory, filePath), filePath)
            .then(() => onFileUploaded(filePath))
        ),
        () =>
          beforeClosingConnection(ftpClient)
            .catch(err => {
              updateStatus('error while deploying');
              // eslint-disable-next-line no-console
              console.error(err);
            })
            .then(() => {
              ftpClient.end();
              return fse.remove(deploymentDirectory);
            }),
      ];

      return operations.reduce(
        (sequence, operation) => sequence.then(operation),
        Promise.resolve()
      );
    }
  );

  return upload;
};

module.exports = ftpDeployPackage;
