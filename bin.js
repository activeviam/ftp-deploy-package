#!/usr/bin/env node
/* eslint-disable no-console */

'use strict';

const promisify = require('es6-promisify');
const ProgressBar = require('progress');
const prompt = require('prompt');
const {argv} = require('yargs').options({
  host: {
    demandOption: true,
    describe: 'hostname without the protocol prefix',
  },
  path: {
    demandOption: true,
    describe: 'remote path where the files should be uploaded',
  },
  user: {
    demandOption: true,
  },
});

const ftpDeployPackage = require('.');

// We could have made the password another command line option but this is a bad practice.
// Indeed, it would expose the password in the process table and leak it into the shell history.
// See https://www.netmeister.org/blog/passing-passwords.html.
// Instead, we use an interactive hidden prompt.
if (argv.password) {
  throw new Error(
    `Giving the password through the command line is risky. Please give it interactively instead.`
  );
}

const promptPassword = () => {
  prompt.start();
  return promisify(prompt.get)([{hidden: true, name: 'password'}]).then(
    ({password}) => password
  );
};

promptPassword().then(password => {
  // eslint-disable-next-line init-declarations
  let progressBar;
  const packageDirectory = process.cwd();

  console.log(`deploying to ${argv.user}@${argv.host}:${argv.path}`);
  return ftpDeployPackage(packageDirectory, Object.assign({password}, argv), {
    beforeUpload(ftpClient, filesToUpload) {
      progressBar = new ProgressBar('[:bar] :current/:total files uploaded', {
        total: filesToUpload.length,
      });
      return Promise.resolve();
    },
    onFileUploaded() {
      progressBar.tick();
    },
    onStatusUpdate(status) {
      if (progressBar) {
        progressBar.interrupt(status);
      } else {
        console.log(status);
      }
    },
  });
});
