-- promote_delayed.lua
-- Atomically finds all jobs due by `now` in the delayed queue
-- and moves them to the active queue.
--
-- KEYS[1] = delayed queue key   e.g. "queue:delayed"
-- KEYS[2] = active queue key    e.g. "queue:default"
-- ARGV[1] = current time in ms  e.g. "1718000000000"
-- ARGV[2] = active queue score base (priority factor)
--
-- Returns: number of jobs promoted

-- 1. Find all jobs with score <= now (their run_at has passed)
local due_jobs = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])

if #due_jobs == 0 then
  return 0
end

local promoted = 0

for _, job_id in ipairs(due_jobs) do
  -- 2. Remove from delayed queue
  redis.call('ZREM', KEYS[1], job_id)

  -- 3. Add to active queue with normal priority score
  --    Score = now_ms so it runs in FIFO order among delayed jobs
  redis.call('ZADD', KEYS[2], tonumber(ARGV[1]) + promoted, job_id)

  promoted = promoted + 1
end

return promoted