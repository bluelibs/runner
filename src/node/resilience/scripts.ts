/** Redis time avoids differences between application clocks. */
const clock = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
`;

export const rateLimitScript = `${clock}
local signature = ARGV[2] .. ':' .. ARGV[3] .. ':' .. ARGV[4]
local prior = redis.call('HGET', KEYS[1], 'policy')
if prior and prior ~= signature then return {-1, 0, 0} end
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now)
for _, key in ipairs(expired) do redis.call('HDEL', KEYS[1], key) end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local raw = redis.call('HGET', KEYS[1], ARGV[1])
local entry
if raw then
  entry = cjson.decode(raw)
else
  if tonumber(ARGV[4]) > 0 and redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then
    return {-2, 0, 0}
  end
  entry = {0, now + tonumber(ARGV[3])}
end
local allowed = 0
if entry[1] < tonumber(ARGV[2]) then
  entry[1] = entry[1] + 1
  allowed = 1
end
redis.call('HSET', KEYS[1], 'policy', signature, ARGV[1], cjson.encode(entry))
redis.call('ZADD', KEYS[2], entry[2], ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
return {allowed, math.max(0, tonumber(ARGV[2]) - entry[1]), entry[2]}
`;

export const circuitScript = `${clock}
local raw = redis.call('GET', KEYS[1])
local state = raw and cjson.decode(raw) or {phase=0, failures=0, generation=ARGV[5], untilAt=0, threshold=tonumber(ARGV[2]), reset=tonumber(ARGV[3]), lease=tonumber(ARGV[4])}
if ARGV[1] ~= 'enter' and not raw then return {-2, 0, 0, ''} end
if ARGV[1] == 'enter' then
  if state.threshold ~= tonumber(ARGV[2]) or state.reset ~= tonumber(ARGV[3]) or state.lease ~= tonumber(ARGV[4]) then
    return {-1, 0, 0, ''}
  end
  local allowed = 1
  if state.phase ~= 0 then
    if now >= state.untilAt then
      state.phase = 2
      state.generation = ARGV[5]
      state.untilAt = now + tonumber(ARGV[4])
    else
      allowed = 0
    end
  end
  redis.call('SET', KEYS[1], cjson.encode(state))
  return {allowed, state.phase, state.failures, state.generation}
end
if raw and state.generation == ARGV[5] then
  if state.phase == 2 and now >= state.untilAt then
    return {-2, state.phase, state.failures, state.generation}
  end
  if ARGV[1] == 'success' then
    state.failures = 0
    if state.phase == 2 then
      state.phase = 0
      state.generation = ARGV[6]
    end
  else
    state.failures = state.failures + 1
    if state.phase == 2 or state.failures >= state.threshold then
      state.phase = 1
      state.generation = ARGV[6]
      state.untilAt = now + state.reset
    end
  end
  redis.call('SET', KEYS[1], cjson.encode(state))
end
return {1, state.phase, state.failures, state.generation}
`;

export const permitScript = `${clock}
local policy = ARGV[2] .. ':' .. ARGV[4]
local limit = redis.call('GET', KEYS[2])
if limit and limit ~= policy then return -1 end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if ARGV[1] == 'release' then
  return redis.call('ZREM', KEYS[1], ARGV[3])
end
if ARGV[1] == 'renew' then
  if not redis.call('ZSCORE', KEYS[1], ARGV[3]) then return 0 end
else
  if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[4]), ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
redis.call('SET', KEYS[2], policy, 'PX', ARGV[4])
return 1
`;
