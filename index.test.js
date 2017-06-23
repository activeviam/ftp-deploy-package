/* eslint-env jest */
/* eslint-disable no-process-env, no-console */

'use strict';

const path = require('path');

const execa = require('execa');
const dotenv = require('dotenv');
const fse = require('fs-extra');

const ftpDeployPackage = require('.');

const packageMockDirectory = path.join(__dirname, 'package-mock');
const packageMockPackageJsonPath = path.join(
  packageMockDirectory,
  'package.json'
);
const packageMockIndexJsContent = '// No content.\n';

const envToConfigMapping = {
  FTP_HOST: 'host',
  FTP_PASSWORD: 'password',
  FTP_REMOTE_PATH: 'path',
  FTP_USER: 'user',
};

const ftpConfig = {};

beforeAll(() => {
  dotenv.config();

  Object.keys(envToConfigMapping).forEach(envKey => {
    const configKey = envToConfigMapping[envKey];

    if (!process.env.hasOwnProperty(envKey)) {
      throw new Error(`Missing environment variable ${envKey}.`);
    }

    ftpConfig[configKey] = process.env[envKey];
  });
});

const timeoutInMilliseconds = 60000;

test(
  'works as expected',
  () =>
    fse
      .emptyDir(packageMockDirectory)
      .then(() => execa('npm', ['init', '-y'], {cwd: packageMockDirectory}))
      .then(() => fse.readJson(packageMockPackageJsonPath))
      .then(packageObj => {
        packageObj.dependencies = {
          'left-pad': '^1.1.3',
        };
        packageObj.files = ['index.js'];
        return fse.writeJson(packageMockPackageJsonPath, packageObj);
      })
      .then(() =>
        fse.writeFile(
          path.join(packageMockDirectory, 'index.js'),
          packageMockIndexJsContent
        )
      )
      .then(() =>
        ftpDeployPackage(packageMockDirectory, ftpConfig, {
          beforeClosingConnection(ftpClient) {
            return ftpClient
              .get('index.js')
              .then(
                readableStream =>
                  new Promise(resolve => {
                    const chunks = [];
                    readableStream.on('data', chunk => {
                      chunks.push(chunk);
                    });
                    readableStream.on('end', () => {
                      const content = Buffer.concat(chunks).toString();
                      expect(content).toBe(packageMockIndexJsContent);
                      resolve();
                    });
                  })
              )
              .then(() => ftpClient.cwd('node_modules/left-pad'))
              .then(() => ftpClient.list())
              .then(list => list.map(({name}) => name))
              .then(names => {
                expect(names).toContain('package.json');
              });
          },
          onFileUploaded(filePath) {
            console.log(`${filePath} uploaded`);
          },
          onStatusUpdate(status) {
            console.log(`status: ${status}`);
          },
        })
      )
      .then(() => fse.remove(packageMockDirectory)),
  timeoutInMilliseconds
);
