import { Summary, SummaryResponse, Transcript } from "@/types";
import { BlockNoteSummaryView } from "@/components/AISummary/BlockNoteSummaryView";
import { EmptyStateSummary } from "@/components/EmptyStateSummary";
import { SummaryGeneratorButtonGroup } from "./SummaryGeneratorButtonGroup";
import { SummaryUpdaterButtonGroup } from "./SummaryUpdaterButtonGroup";
import Analytics from "@/lib/analytics";

export function SummaryToolbar({
  aiSummary,
  isSummaryLoading,
  modelConfig,
  setModelConfig,
  onSaveModelConfig,
  onGenerateSummary,
  onStopGeneration,
  customPrompt,
  summaryStatus,
  availableTemplates,
  selectedTemplate,
  onTemplateSelect,
  transcripts,
  isModelConfigLoading,
  onOpenModelSettings,
  languageSlot,
  isSaving,
  isTitleDirty,
  summaryRef,
  onSaveAll,
  onCopySummary,
  onPlaySummary,
  onStopSummaryPlayback,
  onOpenFolder,
  isPlayingSummary,
  isSummaryPlaybackSupported,
}: any) {
  if (!aiSummary || isSummaryLoading) return <div className="p-4 border-b border-gray-200" />;

  return (
    <div className="p-4 border-b border-gray-200">
      <div className="flex items-center justify-center w-full pt-0 gap-2">
        <div className="flex-shrink-0">
          <SummaryGeneratorButtonGroup
            modelConfig={modelConfig}
            setModelConfig={setModelConfig}
            onSaveModelConfig={onSaveModelConfig}
            onGenerateSummary={onGenerateSummary}
            onStopGeneration={onStopGeneration}
            customPrompt={customPrompt}
            summaryStatus={summaryStatus}
            availableTemplates={availableTemplates}
            selectedTemplate={selectedTemplate}
            onTemplateSelect={onTemplateSelect}
            hasTranscripts={transcripts.length > 0}
            hasSummary={!!aiSummary}
            isModelConfigLoading={isModelConfigLoading}
            onOpenModelSettings={onOpenModelSettings}
            languageSlot={languageSlot}
          />
        </div>
        <div className="flex-shrink-0">
          <SummaryUpdaterButtonGroup
            isSaving={isSaving}
            isDirty={isTitleDirty || summaryRef.current?.isDirty || false}
            onSave={onSaveAll}
            onCopy={onCopySummary}
            onPlay={onPlaySummary}
            onStopPlayback={onStopSummaryPlayback}
            onFind={() => {
              console.log("Find in summary clicked");
            }}
            onOpenFolder={onOpenFolder}
            hasSummary={!!aiSummary}
            isPlayingSummary={isPlayingSummary}
            isSummaryPlaybackSupported={isSummaryPlaybackSupported}
          />
        </div>
      </div>
    </div>
  );
}

function SummaryGenerationState({
  modelConfig,
  setModelConfig,
  onSaveModelConfig,
  onGenerateSummary,
  onStopGeneration,
  customPrompt,
  summaryStatus,
  availableTemplates,
  selectedTemplate,
  onTemplateSelect,
  transcripts,
  isModelConfigLoading,
  onOpenModelSettings,
}: any) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-center pt-8 pb-4">
        <SummaryGeneratorButtonGroup
          modelConfig={modelConfig}
          setModelConfig={setModelConfig}
          onSaveModelConfig={onSaveModelConfig}
          onGenerateSummary={onGenerateSummary}
          onStopGeneration={onStopGeneration}
          customPrompt={customPrompt}
          summaryStatus={summaryStatus}
          availableTemplates={availableTemplates}
          selectedTemplate={selectedTemplate}
          onTemplateSelect={onTemplateSelect}
          hasTranscripts={transcripts.length > 0}
          isModelConfigLoading={isModelConfigLoading}
          onOpenModelSettings={onOpenModelSettings}
        />
      </div>
      <div className="flex items-center justify-center flex-1">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
          <p className="text-gray-600">Generating AI Summary...</p>
        </div>
      </div>
    </div>
  );
}

function EmptySummaryState({
  modelConfig,
  setModelConfig,
  onSaveModelConfig,
  onGenerateSummary,
  onStopGeneration,
  customPrompt,
  summaryStatus,
  availableTemplates,
  selectedTemplate,
  onTemplateSelect,
  transcripts,
  isModelConfigLoading,
  onOpenModelSettings,
  languageSlot,
}: any) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-center gap-2 pt-8 pb-4">
        <SummaryGeneratorButtonGroup
          modelConfig={modelConfig}
          setModelConfig={setModelConfig}
          onSaveModelConfig={onSaveModelConfig}
          onGenerateSummary={onGenerateSummary}
          onStopGeneration={onStopGeneration}
          customPrompt={customPrompt}
          summaryStatus={summaryStatus}
          availableTemplates={availableTemplates}
          selectedTemplate={selectedTemplate}
          onTemplateSelect={onTemplateSelect}
          hasTranscripts={transcripts.length > 0}
          hasSummary={false}
          isModelConfigLoading={isModelConfigLoading}
          onOpenModelSettings={onOpenModelSettings}
          languageSlot={transcripts.length > 0 ? languageSlot : undefined}
        />
      </div>
      <EmptyStateSummary
        onGenerate={() => onGenerateSummary(customPrompt)}
        hasModel={modelConfig.provider !== null && modelConfig.model !== null}
        isGenerating={false}
      />
    </div>
  );
}

function SummaryResponseOverlay({ summaryResponse }: { summaryResponse: SummaryResponse }) {
  const sections: Array<[string, Array<{ content: string }>]> = [
    ["Key Points", summaryResponse.summary.key_points.blocks],
    ["Action Items", summaryResponse.summary.action_items.blocks],
    ["Decisions", summaryResponse.summary.decisions.blocks],
    ["Main Topics", summaryResponse.summary.main_topics.blocks],
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white shadow-lg p-4 max-h-1/3 overflow-y-auto">
      <h3 className="text-lg font-semibold mb-2">Meeting Summary</h3>
      <div className="grid grid-cols-2 gap-4">
        {sections.map(([title, blocks]) => (
          <div key={title} className="bg-white p-4 rounded-lg shadow-sm mt-4">
            <h4 className="font-medium mb-1">{title}</h4>
            <ul className="list-disc pl-4">
              {blocks.map((block, index) => (
                <li key={index} className="text-sm">
                  {block.content}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {summaryResponse.raw_summary ? (
        <div className="mt-4">
          <h4 className="font-medium mb-1">Full Summary</h4>
          <p className="text-sm whitespace-pre-wrap">{summaryResponse.raw_summary}</p>
        </div>
      ) : null}
    </div>
  );
}

function SummaryStatusMessage({ summaryStatus, getSummaryStatusMessage }: any) {
  if (summaryStatus === "idle") return null;

  const className =
    summaryStatus === "error"
      ? "bg-red-100 text-red-700"
      : summaryStatus === "completed"
        ? "bg-green-100 text-green-700"
        : "bg-blue-100 text-blue-700";

  return (
    <div className={`mt-4 p-4 rounded-lg ${className}`}>
      <p className="text-sm font-medium">{getSummaryStatusMessage(summaryStatus)}</p>
    </div>
  );
}

function SummaryContentState({
  summaryResponse,
  summaryRef,
  aiSummary,
  onSaveSummary,
  onSummaryChange,
  onDirtyChange,
  summaryStatus,
  summaryError,
  onRegenerateSummary,
  meeting,
  meetingTitle,
  getSummaryStatusMessage,
}: any) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      {summaryResponse && <SummaryResponseOverlay summaryResponse={summaryResponse} />}
      <div className="p-6 w-full">
        <BlockNoteSummaryView
          ref={summaryRef}
          summaryData={aiSummary}
          onSave={onSaveSummary}
          onSummaryChange={onSummaryChange}
          onDirtyChange={onDirtyChange}
          status={summaryStatus}
          error={summaryError}
          onRegenerateSummary={() => {
            Analytics.trackButtonClick("regenerate_summary", "meeting_details");
            onRegenerateSummary();
          }}
          meeting={{ id: meeting.id, title: meetingTitle, created_at: meeting.created_at }}
        />
      </div>
      <SummaryStatusMessage
        summaryStatus={summaryStatus}
        getSummaryStatusMessage={getSummaryStatusMessage}
      />
    </div>
  );
}

export function SummaryPanelBody({
  isSummaryLoading,
  aiSummary,
  transcripts,
  bodyProps,
}: {
  isSummaryLoading: boolean;
  aiSummary: Summary | null;
  transcripts: Transcript[];
  bodyProps: any;
}) {
  if (isSummaryLoading) return <SummaryGenerationState {...bodyProps} transcripts={transcripts} />;
  if (!aiSummary) return <EmptySummaryState {...bodyProps} transcripts={transcripts} />;
  if (!transcripts?.length) return null;

  return <SummaryContentState {...bodyProps} aiSummary={aiSummary} />;
}
