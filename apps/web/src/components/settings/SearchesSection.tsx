"use client";

import { useConfig } from "@/lib/config/provider";
import { defaults } from "@/lib/config/defaults";
import {
  SectionCard,
  NumberControl,
  ToggleControl,
  TextFieldControl,
  SelectControl,
} from "@/components/settings/controls";

export function SearchesSection() {
  const { settings, setOption } = useConfig();
  const s = settings.searches;

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Search results"
        description="How many results are kept and shown for a query."
      >
        <NumberControl
          label="Maximum results per search"
          description="Results received before the search stops."
          value={s.maxresults}
          min={1}
          max={10000}
          onChange={(v) => setOption("searches", "maxresults", v)}
          onReset={() => setOption("searches", "maxresults", defaults.searches.maxresults)}
        />
        <NumberControl
          label="Maximum displayed results"
          description="How many results are shown in the list."
          value={s.max_displayed_results}
          min={100}
          max={25000}
          step={50}
          onChange={(v) => setOption("searches", "max_displayed_results", v)}
          onReset={() =>
            setOption("searches", "max_displayed_results", defaults.searches.max_displayed_results)
          }
        />
        <NumberControl
          label="Minimum search term length"
          description="Shortest query allowed when searching."
          value={s.min_search_chars}
          min={1}
          max={50}
          onChange={(v) => setOption("searches", "min_search_chars", v)}
          onReset={() =>
            setOption("searches", "min_search_chars", defaults.searches.min_search_chars)
          }
        />
        <ToggleControl
          label="Respond to search requests"
          description="Allow your shared files to appear in network searches."
          checked={s.search_results}
          onChange={(v) => setOption("searches", "search_results", v)}
        />
        <ToggleControl
          label="Show private search results"
          description="Display results sent directly to you via private rooms."
          checked={s.private_search_results}
          onChange={(v) => setOption("searches", "private_search_results", v)}
        />
        <ToggleControl
          label="Keep search history"
          description="Remember past search queries in the search bar."
          checked={s.enable_history}
          onChange={(v) => setOption("searches", "enable_history", v)}
        />
        <ToggleControl
          label="Filters visible by default"
          checked={s.filters_visible}
          onChange={(v) => setOption("searches", "filters_visible", v)}
        />
        <SelectControl
          label="Expand results"
          value={s.expand_results}
          onChange={(v) => setOption("searches", "expand_results", v)}
          options={[
            { value: "all", label: "Expand all" },
            { value: "partial", label: "Partial (nicotine parity)" },
            { value: "none", label: "Collapse all" },
          ]}
        />
        <SelectControl
          label="Grouping"
          value={s.group_searches}
          onChange={(v) => setOption("searches", "group_searches", v)}
          options={[
            { value: "ungrouped", label: "Ungrouped" },
            { value: "folder_grouping", label: "By folder" },
            { value: "user_grouping", label: "By user" },
          ]}
        />
        {s.history.length > 0 ? (
          <div className="py-3">
            <button
              type="button"
              onClick={() => setOption("searches", "history", [])}
              className="font-label text-xs uppercase tracking-widest text-error hover:underline"
            >
              Clear search history ({s.history.length})
            </button>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Default filters"
        description="Filters applied to every new search. Leave blank to disable a filter."
      >
        <ToggleControl
          label="Enable default filters"
          description="Apply the filters below to every search."
          checked={s.enablefilters}
          onChange={(v) => setOption("searches", "enablefilters", v)}
        />
        <TextFieldControl
          label="Include"
          value={s.defilter.include}
          onChange={(v) => setOption("searches", "defilter", { ...s.defilter, include: v })}
        />
        <TextFieldControl
          label="Exclude"
          value={s.defilter.exclude}
          onChange={(v) => setOption("searches", "defilter", { ...s.defilter, exclude: v })}
        />
        <TextFieldControl
          label="File size"
          value={s.defilter.fileSize}
          onChange={(v) => setOption("searches", "defilter", { ...s.defilter, fileSize: v })}
        />
        <TextFieldControl
          label="Bitrate"
          value={s.defilter.bitrate}
          onChange={(v) => setOption("searches", "defilter", { ...s.defilter, bitrate: v })}
        />
        <TextFieldControl
          label="Country"
          value={s.defilter.country}
          onChange={(v) => setOption("searches", "defilter", { ...s.defilter, country: v })}
        />
        <TextFieldControl
          label="File type"
          value={s.defilter.fileType}
          onChange={(v) => setOption("searches", "defilter", { ...s.defilter, fileType: v })}
        />
        <TextFieldControl
          label="Length"
          value={s.defilter.length}
          onChange={(v) => setOption("searches", "defilter", { ...s.defilter, length: v })}
        />
        <TextFieldControl
          label="Quality"
          description="lossless | 320 | hi-res | !transcode"
          value={(s.defilter as unknown as { quality?: string }).quality ?? ""}
          onChange={(v) => setOption("searches", "defilter", { ...s.defilter, quality: v } as unknown as typeof s.defilter)}
        />
        <ToggleControl
          label="Only free slots"
          description="Only show results from users with a free upload slot."
          checked={s.defilter.freeSlots}
          onChange={(v) => setOption("searches", "defilter", { ...s.defilter, freeSlots: v })}
        />
        <ToggleControl
          label="Public files only"
          description="Only show results from users who are sharing publicly."
          checked={s.defilter.publicFiles}
          onChange={(v) => setOption("searches", "defilter", { ...s.defilter, publicFiles: v })}
        />
      </SectionCard>
    </div>
  );
}
