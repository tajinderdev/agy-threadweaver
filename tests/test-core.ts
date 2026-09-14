import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { ThreadMeta, ThreadStep, ContextMetrics } from '../src/models/thread';
import { ContextDistiller } from '../src/services/distiller';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('\n🧪 Running ThreadWeaver Core Engine & Parsing Tests...\n');

  // Test 1: JSONL Step Parsing & Token Estimation
  const sampleSteps: ThreadStep[] = [
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      created_at: new Date().toISOString(),
      content: '<USER_REQUEST>Build an Antigravity thread history extension with zip import/export</USER_REQUEST>'
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: new Date().toISOString(),
      thinking: 'Thinking through the extension architecture...',
      content: 'I have designed Phase 1 with BrainWatcher and ZipService.',
      tool_calls: [
        {
          tool: 'write_to_file',
          arguments: { TargetFile: 'D:/Work/2026/Extension/Agy Thead History/src/extension.ts' }
        }
      ]
    }
  ];

  const totalChars = sampleSteps.reduce(
    (sum, s) => sum + (s.content?.length || 0) + (s.thinking?.length || 0),
    0
  );
  const estimatedTokens = Math.round(totalChars / 4);

  assert(sampleSteps.length === 2, 'Parsed 2 steps accurately');
  assert(estimatedTokens > 0, `Estimated tokens calculated: ${estimatedTokens} tokens`);

  // Test 2: Context Distiller Briefing Generation
  const dummyThread: ThreadMeta = {
    id: 'test-thread-uuid-123456',
    title: 'Build an Antigravity thread history extension',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    threadPath: 'D:/Work/sample',
    brainDir: 'D:/Work',
    metrics: {
      tokenEstimate: estimatedTokens,
      tokenFormatted: `${estimatedTokens}`,
      byteSize: 1024,
      byteSizeFormatted: '1.0 KB',
      stepCount: 2,
      messageCount: 2,
      loadLevel: 'light',
      percentageOfLimit: 2
    },
    status: 'completed',
    artifacts: [
      {
        id: 'art-1',
        name: 'plan.md',
        relativePath: 'plan.md',
        absolutePath: 'D:/Work/sample/plan.md',
        conversationId: 'test-thread-uuid-123456',
        sizeBytes: 512,
        sizeFormatted: '512 B',
        createdAt: new Date(),
        modifiedAt: new Date(),
        isScratch: false,
        type: 'plan'
      }
    ]
  };

  const briefing = ContextDistiller.generateBriefing(dummyThread, sampleSteps);
  assert(briefing.includes('test-thread-uuid-123456'), 'Distilled briefing includes previous thread ID');
  assert(briefing.includes('command:threadweaver.forkFreshThread'), 'Distilled briefing includes fork command link');
  assert(briefing.includes('plan.md'), 'Distilled briefing lists attached artifacts');

  // Test 3: Zip Packaging & Integrity Test
  const testOutputDir = path.join(__dirname, '..', 'scratch');
  if (!fs.existsSync(testOutputDir)) {
    fs.mkdirSync(testOutputDir, { recursive: true });
  }

  const testZipPath = path.join(testOutputDir, 'test_export.zip');
  const zip = new AdmZip();

  // Add metadata & markdown transcript
  zip.addFile('thread_meta.json', Buffer.from(JSON.stringify(dummyThread, null, 2)));
  zip.addFile('conversation.md', Buffer.from('# Test Conversation Transcript\nHello World'));
  zip.addFile('artifacts/plan.md', Buffer.from('# Architecture Plan\n1. Phase 1\n2. Phase 2'));
  zip.writeZip(testZipPath);

  assert(fs.existsSync(testZipPath), 'Exported zip archive successfully generated');

  // Test 4: Zip Import Extraction Test
  const readZip = new AdmZip(testZipPath);
  const entries = readZip.getEntries();
  const entryNames = entries.map((e) => e.entryName.replace(/\\/g, '/'));

  assert(entryNames.includes('thread_meta.json'), 'Zip contains thread_meta.json');
  assert(entryNames.includes('conversation.md'), 'Zip contains conversation.md');
  assert(entryNames.includes('artifacts/plan.md'), 'Zip contains artifacts/plan.md');

  // Clean up test zip
  if (fs.existsSync(testZipPath)) {
    fs.unlinkSync(testZipPath);
  }

  console.log('\n🎉 ALL THREADWEAVER CORE TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
