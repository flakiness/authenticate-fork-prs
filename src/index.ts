// Lets a job in a pull request from a fork upload to flakiness.io. GitHub gives such jobs
// neither secrets nor OIDC tokens, so the job proves it's part of its workflow run instead:
// it uploads an artifact named after the hash of a random secret into the run, and
// flakiness.io exchanges the secret for an access token once it finds that artifact.

import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const project = core.getInput('flakiness-project') || process.env.FLAKINESS_PROJECT;
if (!project) {
  core.setFailed('Set the flakiness-project input or the FLAKINESS_PROJECT environment variable to "org/project".');
  process.exit(1);
}
const [orgSlug, projectSlug] = project.split('/');
const endpoint = core.getInput('endpoint');
const githubToken = core.getInput('github-token');

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH!, 'utf8'));
if (process.env.GITHUB_EVENT_NAME !== 'pull_request' || event.pull_request.head.repo?.id === event.pull_request.base.repo.id) {
  core.notice('Skipping: not a pull request from a fork.');
  process.exit(0);
}

// Anyone can see the artifact's name, but it gives away only the hash of the secret.
const secret = randomBytes(32).toString('hex');
core.setSecret(secret);
const artifactName = `flakiness-auth-${createHash('sha256').update(secret).digest('hex')}`;

const dir = await mkdtemp(path.join(process.env.RUNNER_TEMP!, 'flakiness-'));
const file = path.join(dir, 'proof.txt');
await writeFile(file, 'flakiness.io authorization. Safe to delete.\n');
const artifacts = new DefaultArtifactClient();
await artifacts.uploadArtifact(artifactName, [file], dir, { retentionDays: 1 });

const response = await fetch(`${endpoint}/api/githubForkPR/authenticate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    orgSlug,
    projectSlug,
    runId: Number(process.env.GITHUB_RUN_ID), secret, githubToken,
  }),
});
await artifacts.deleteArtifact(artifactName).catch(e => core.warning(`Failed to delete artifact ${artifactName}: ${e}`));

if (response.ok) {
  const { accessToken } = await response.json();
  core.setSecret(accessToken);
  core.exportVariable('FLAKINESS_ACCESS_TOKEN', accessToken);
  core.info('Set FLAKINESS_ACCESS_TOKEN for the following steps.');
} else {
  core.setFailed(`flakiness.io did not issue an access token: HTTP ${response.status} ${await response.text()}`);
}
