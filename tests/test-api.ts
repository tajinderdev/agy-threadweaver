import * as fs from 'fs';
import * as path from 'path';

// Mock the 'vscode' module so it can be required in a raw Node script
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: () => undefined }), workspaceFolders: [] },
      EventEmitter: class { event = {}; fire() {} },
      window: { showInformationMessage: () => {}, showErrorMessage: () => {} },
      Uri: { file: (p: string) => ({ fsPath: p }) }
    };
  }
  return originalRequire.apply(this, arguments);
};

import { ApiServer } from '../src/api/server';
import { BrainWatcher } from '../src/services/brainWatcher';

// Simple mock for VS Code context
const mockContext: any = {
  globalState: {
    update: () => {}
  }
};

// Mock BrainWatcher to return some dummy data
class MockBrainWatcher extends BrainWatcher {
  constructor() {
    super(mockContext, {} as any);
  }
  
  // Override refresh and init methods that access real FS
  public resolveAllBrainDirectories() { return []; }
  
  public getThreads(): any[] {
    return [
      {
        id: 'thread-1',
        status: 'active',
        surface: 'wsl',
        workspaceUri: 'file:///d:/Work/project-A',
        workspace: { name: 'project-A' },
        artifacts: [
          { name: 'plan.md', absolutePath: 'dummy/path/plan.md' }
        ]
      },
      {
        id: 'thread-2',
        status: 'completed',
        surface: 'windows',
        workspaceUri: 'file:///d:/Work/project-A',
        workspace: { name: 'project-A' },
        artifacts: []
      }
    ];
  }

  public getThread(id: string): any {
    return this.getThreads().find(t => t.id === id);
  }

  public async loadTranscript(id: string): Promise<any[]> {
    return [{ type: 'USER_INPUT', content: 'hello' }];
  }
  
  public dispose() {}
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('\n🧪 Running ThreadWeaver Local API Tests...\n');

  const mockBrainWatcher = new MockBrainWatcher();
  const apiServer = new ApiServer(mockContext, mockBrainWatcher as any);

  try {
    await apiServer.start();
    const port = apiServer.getPort();
    const token = apiServer.getToken();
    
    assert(port > 0, `API Server started successfully on port ${port}`);
    assert(token.length > 0, `Secure Bearer token generated`);

    const baseUrl = `http://127.0.0.1:${port}/api/v1`;
    const headers = { 'Authorization': `Bearer ${token}` };

    // Test 1: Security (No Token)
    let res = await fetch(`${baseUrl}/workspaces`);
    assert(res.status === 401, `Rejected unauthorized request without token (Status 401)`);

    // Test 2: Security (Bad Token)
    res = await fetch(`${baseUrl}/workspaces`, { headers: { 'Authorization': 'Bearer BADTOKEN' }});
    assert(res.status === 401, `Rejected unauthorized request with bad token (Status 401)`);

    // Test 3: Get Workspaces
    res = await fetch(`${baseUrl}/workspaces`, { headers });
    assert(res.status === 200, `Authorized request to /workspaces succeeded`);
    let data: any = await res.json();
    assert(data.workspaces.length === 1, `Correctly aggregated 1 unique workspace`);
    assert(data.workspaces[0].threadCount === 2, `Workspace thread count is 2`);

    // Test 4: Get Threads (Filtered)
    res = await fetch(`${baseUrl}/threads?status=active`, { headers });
    data = await res.json();
    assert(data.threads.length === 1, `Successfully filtered threads by status`);
    assert(data.threads[0].id === 'thread-1', `Returned correct thread-1`);

    // Test 5: Get Thread Details & Transcript
    res = await fetch(`${baseUrl}/threads/thread-1`, { headers });
    data = await res.json();
    assert(data.meta.id === 'thread-1', `Successfully fetched thread-1 details`);
    assert(data.transcript.length === 1, `Successfully loaded thread-1 transcript`);

    // Test 6: Get Artifacts
    res = await fetch(`${baseUrl}/threads/thread-1/artifacts`, { headers });
    data = await res.json();
    assert(data.artifacts.length === 1, `Successfully fetched artifact list`);
    assert(data.artifacts[0].name === 'plan.md', `Artifact name matches`);

    console.log('\n🎉 ALL THREADWEAVER API TESTS PASSED SUCCESSFULLY!\n');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  } finally {
    apiServer.stop();
    mockBrainWatcher.dispose();
  }
}

runTests();
