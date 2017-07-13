/* eslint-env jest */
/* eslint-disable no-process-env, no-console */

'use strict';

const path = require('path');

const execa = require('execa');
const fse = require('fs-extra');
const ftpd = require('ftpd');

const ftpDeployPackage = require('.');

const packageMockDirectory = path.join(__dirname, 'package-mock');
const packageMockPackageJsonPath = path.join(
  packageMockDirectory,
  'package.json'
);
const packageMockIndexJsContent = '// No content.\n';

const ftpConfig = {
  host: '127.0.0.1',
  password: 'the-password',
  path: 'ftp-server',
  port: '7002',
  user: 'the-user',
};

// eslint-disable-next-line init-declarations
let server;

beforeEach(() => {
  server = new ftpd.FtpServer(ftpConfig.host, {
    getInitialCwd() {
      return '/';
    },
    getRoot() {
      return process.cwd();
    },
  });

  server.on('error', error => {
    console.log('FTP Server error:', error);
  });

  server.on('client:connected', connection => {
    connection.on('command:user', (user, success, failure) => {
      if (user === ftpConfig.user) {
        success();
      } else {
        failure();
      }
    });

    connection.on('command:pass', (password, success, failure) => {
      if (password === ftpConfig.password) {
        success(ftpConfig.user);
      } else {
        failure();
      }
    });
  });

  server.listen(ftpConfig.port);
});

afterEach(() => {
  server.close();
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
        })
      )
      .then(() => fse.remove(packageMockDirectory)),
  timeoutInMilliseconds
);
