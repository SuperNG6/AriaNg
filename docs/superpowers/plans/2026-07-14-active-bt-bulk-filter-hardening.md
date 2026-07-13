# Active BT Bulk Filter Hardening Plan

Date: 2026-07-14

1. Add lifecycle operation tokens so callbacks from stop, restart, unauthorized disconnect, or RPC switching cannot mutate the new lifecycle.
2. Make automatic/bulk boundary scheduling fair while keeping the current bulk item pinned.
3. Exclude children still owned by automatic filtering through both `following` and persisted `childGid` relationships, revalidating stale snapshots before the first mutation.
4. Order initial option/task inspection so the mutation uses the latest selected files and active state without adding a per-task RPC.
5. Gate settlement and completion on durable checkpoints and discard uncommitted orphan definitions at startup.
6. Preserve selection and run state when duplicate-InfoHash recovery adopts an already existing BT task.
7. Unify threshold state, debounce preview scans, bind fresh responses to a monotonic completion ID, prevent stale resubmission from delayed/cached snapshots, actively and retryably refresh completion even when periodic refresh is disabled, cancel superseded/Unauthorized timers, surface enqueue failure, and retain global progress when Files is closed.
8. Tighten responsive layout, contrast, six-digit input width, accessible toolbar/progress naming, and compact live-region text; synchronize all translations.
9. Validate linear preview performance, run the complete regression/lint/build gates, inspect the supplied aria2 read-only, and record the remaining real-browser visual evidence explicitly.
