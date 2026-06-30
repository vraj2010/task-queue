-- claim_job.lua
-- Atomically pops the highest-priority job from the queue
-- and sets a visibility timeout key.
--
-- KEYS[1] = queue key          e.g. "queue:default"
-- KEYS[2] = processing prefix  e.g. "processing"
-- ARGV[1] = visibility timeout in seconds  e.g. "300"
--
-- Returns: job_id string, or nil if queue is empty

-- 1. Pop the lowest-score (= highest priority) job
local result = redis.call('ZPOPMIN', KEYS[1], 1)

-- 2. If queue is empty, return nil immediately
if #result == 0 then
  return nil
end

local job_id = result[1]   -- result = {job_id, score}

-- 3. Set visibility timeout key with TTL
--    Key: "processing:job_abc123"
--    Value: timestamp of when it was claimed (useful for debugging)
--    EX: expires after ARGV[1] seconds
redis.call('SET',
  KEYS[2] .. ':' .. job_id,
  redis.call('TIME')[1],   -- current Unix timestamp as value
  'EX', tonumber(ARGV[1])
)

-- 4. Return the job_id to the caller
return job_id