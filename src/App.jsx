import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  Clock, BarChart3, Settings2, Edit3, GripHorizontal, Plus, Trash2, 
  Upload, Database, X, HelpCircle, Layers, Move, List, 
  Copy, Check, PenLine, Save, FileText, ZoomIn, ZoomOut
} from 'lucide-react';

// --- 定数定義 ---

// チャート設定
const MIN_ELAPSED_TIME = 2; // チャート開始の最小経過時間 (秒)
const STORAGE_KEY = 'time-gantt-data-v1'; // LocalStorageのキー
const UNIQUE_FACTOR = 1.19; // 固有時間の倍率係数

const TIME_OPTIONS = [
  { label: '3分30秒', value: 210 },
  { label: '4分00秒', value: 240 },
  { label: '4分30秒', value: 270 },
];

const COLORS = [
  'bg-blue-500', 'bg-green-500', 'bg-teal-500', 
  'bg-indigo-500', 'bg-purple-500', 'bg-rose-500'
];

// ズームレベル定義
const ZOOM_LEVELS = [
  { scale: 1, interval: 10, label: 'x1 (10s)' },
  { scale: 2, interval: 5, label: 'x2 (5s)' },
  { scale: 5, interval: 1, label: 'x5 (1s)' },
  { scale: 10, interval: 0.5, label: 'x10 (0.5s)' },
  { scale: 20, interval: 0.1, label: 'x20 (0.1s)' }, 
];

// --- ユーティリティ関数 ---

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substr(2, 9);
};

const formatTimeFixed = (seconds) => {
  const sign = seconds < 0 ? '-' : '';
  const absSeconds = Math.abs(seconds);
  const m = Math.floor(absSeconds / 60);
  const s = absSeconds % 60;
  const sInt = Math.floor(s);
  const sDec = (s - sInt).toFixed(3).substring(1); 
  const sStr = sInt.toString().padStart(2, '0') + sDec;
  
  return `${sign}${m}:${sStr}`;
};

const formatTime = (seconds) => {
  const sign = seconds < 0 ? '-' : '';
  const absSeconds = Math.abs(seconds);
  const m = Math.floor(absSeconds / 60);
  const s = absSeconds % 60;
  
  let sStr;
  if (Number.isInteger(s)) {
    sStr = s.toString().padStart(2, '0');
  } else {
    const sInt = Math.floor(s);
    const sDec = (s - sInt).toFixed(3).substring(1);
    sStr = sInt.toString().padStart(2, '0') + sDec;
  }
  return `${sign}${m}:${sStr}`;
};

const toRemaining = (elapsed, totalDuration) => totalDuration - elapsed;

const fromRemaining = (remaining, totalDuration) => {
  const elapsed = totalDuration - remaining;
  return Math.max(MIN_ELAPSED_TIME, elapsed);
};

const calculateUniqueDuration = (currentDuration, isUnique) => {
  let newDuration = currentDuration;
  if (isUnique) {
    newDuration = newDuration * UNIQUE_FACTOR;
  } else {
    newDuration = newDuration / UNIQUE_FACTOR;
  }
  return Math.round(newDuration * 100) / 100;
};

// NSバー生成ロジック (全遅延のみ: Start + (Index * Gap))
const generateNSBars = (nsConfig, totalTime) => {
  const bars = [];
  const { start = 0, castTime = 0, gap, duration } = nsConfig;
  
  const actualBaseStart = Math.max(MIN_ELAPSED_TIME, start);

  const safeGap = Math.max(gap, 0.1); 
  const safeDuration = Math.max(duration, 0.001);
  // 安全のための上限設定
  const maxBars = 1000; 

  let index = 0;

  while (true) {
    // 常に規則的な配置
    const currentStart = actualBaseStart + (index * safeGap);

    if (currentStart >= totalTime + safeDuration + castTime) break;

    bars.push({ 
      index: index,
      start: currentStart,      
      castTime: castTime,
      duration: safeDuration 
    });

    index++;
    
    if (index >= maxBars) break;
  }
  return bars;
};

const calculateExOverlaps = (tasks, totalDuration) => {
  const events = [];
  tasks.forEach(task => {
    if (!task.checkOverlap) return;

    task.ex.forEach(block => {
      const castTime = block.castTime || 0;
      const effectStart = block.start + castTime;
      
      if (block.duration > 0) {
        events.push({ time: effectStart, type: 1 });
        events.push({ time: effectStart + block.duration, type: -1 });
      }
    });
  });

  events.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    return a.type - b.type;
  });

  const overlaps = [];
  let count = 0;
  let overlapStart = null;

  events.forEach(event => {
    const prevCount = count;
    count += event.type;

    if (prevCount < 2 && count >= 2) {
      overlapStart = event.time;
    }
    if (prevCount >= 2 && count < 2 && overlapStart !== null) {
      if (event.time > overlapStart + 0.001) {
        overlaps.push({ start: overlapStart, end: event.time });
      }
      overlapStart = null;
    }
  });

  return overlaps;
};

const getTimeParts = (secVal) => {
  const absVal = Math.max(0, secVal);
  const m = Math.floor(absVal / 60);
  const s = Math.floor(absVal % 60);
  const ms = Math.round((absVal - Math.floor(absVal)) * 1000);
  return { 
    m: m.toString(), 
    s: s.toString().padStart(2, '0'), 
    ms: ms.toString().padStart(3, '0') 
  };
};

// --- サブコンポーネント ---

const TimeInput = React.memo(({ value, onChange, min = 0, max, className, autoFocus }) => {
  const [parts, setParts] = useState(() => getTimeParts(value));
  const containerRef = useRef(null);
  const mRef = useRef(null);

  useEffect(() => {
    const isFocused = containerRef.current && containerRef.current.contains(document.activeElement);
    if (!isFocused) {
      setParts(getTimeParts(value));
    }
  }, [value]);

  useEffect(() => {
    if (autoFocus && mRef.current) {
      mRef.current.select();
    }
  }, [autoFocus]);

  const handleChange = useCallback((part, val) => {
    if (val !== '' && !/^\d+$/.test(val)) return;
    setParts(prev => ({ ...prev, [part]: val }));
  }, []);

  const handleCommit = useCallback(() => {
    setParts(currentParts => {
      const m = parseInt(currentParts.m || '0', 10);
      const s = parseInt(currentParts.s || '0', 10);
      const ms = parseInt(currentParts.ms || '0', 10);
      
      let totalSeconds = m * 60 + s + ms / 1000;
      totalSeconds = Math.max(totalSeconds, min);
      if (max !== undefined) {
        totalSeconds = Math.min(totalSeconds, max);
      }
      
      onChange(totalSeconds);
      return getTimeParts(totalSeconds); 
    });
  }, [min, max, onChange]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.target.blur();
    }
  };

  return (
    <div 
      ref={containerRef}
      className={`flex items-center bg-white border border-gray-300 rounded px-1 focus-within:ring-1 focus-within:ring-blue-300 focus-within:border-blue-400 ${className}`}
    >
      <input
        ref={mRef}
        type="text"
        className="w-5 text-right text-xs outline-none p-0 border-none bg-transparent"
        value={parts.m}
        onChange={(e) => handleChange('m', e.target.value)}
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
        placeholder="0"
      />
      <span className="text-gray-400 text-xs px-0.5">:</span>
      <input
        type="text"
        className="w-5 text-right text-xs outline-none p-0 border-none bg-transparent"
        value={parts.s}
        onChange={(e) => handleChange('s', e.target.value)}
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
        placeholder="00"
      />
      <span className="text-gray-400 text-xs px-0.5">.</span>
      <input
        type="text"
        className="w-6 text-right text-xs outline-none p-0 border-none bg-transparent"
        value={parts.ms}
        onChange={(e) => handleChange('ms', e.target.value)}
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
        placeholder="000"
      />
    </div>
  );
});

const EditTimeModal = ({ initialValue, onSave, onClose, totalDuration, title }) => {
  const [value, setValue] = useState(initialValue);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col">
        <div className="bg-slate-800 p-3 text-white flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            <h2 className="font-bold text-sm">開始時間の変更</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        <div className="p-6">
          <div className="text-sm font-bold text-gray-700 mb-1">{title}</div>
          <p className="text-xs text-gray-500 mb-4">残り時間を指定してください (mm:ss.mss)</p>
          
          <div className="flex justify-center mb-6">
            <TimeInput 
              autoFocus
              className="w-40 px-2 py-2 text-lg border-2 border-blue-200 rounded-md"
              value={value}
              onChange={setValue}
              max={totalDuration - MIN_ELAPSED_TIME}
              min={0}
            />
          </div>

          <div className="flex justify-end gap-2">
            <button 
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
            >
              キャンセル
            </button>
            <button 
              onClick={() => { onSave(value); onClose(); }}
              className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1"
            >
              <Save className="w-4 h-4" />
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const GanttBackground = React.memo(({ totalDuration, overlaps, isDragging, tickInterval }) => {
  const gridLines = useMemo(() => {
    return Array.from({ length: Math.floor(totalDuration / tickInterval) + 1 }).map((_, i) => {
      const elapsed = i * tickInterval;
      const leftPos = (elapsed / totalDuration) * 100;
      return { key: i, left: leftPos };
    });
  }, [totalDuration, tickInterval]);

  return (
    <div className="absolute inset-0 flex pointer-events-none z-0">
      <div className="w-40 bg-gray-100 border-r border-gray-200 h-full shrink-0 sticky left-0 z-10"></div>
      
      <div className="flex-1 relative h-full">
        <div className="absolute left-0 top-0 bottom-0 bg-red-50/50 z-0 border-r border-red-200 border-dashed"
             style={{ width: `${(MIN_ELAPSED_TIME / totalDuration) * 100}%` }}>
        </div>

        {!isDragging && overlaps.map((overlap, i) => {
          const left = (overlap.start / totalDuration) * 100;
          const width = ((overlap.end - overlap.start) / totalDuration) * 100;
          if (width <= 0) return null;
          return (
            <div 
              key={`overlap-${i}`}
              className="absolute top-0 bottom-0 bg-red-200/40 border-x border-red-300/50 z-0 flex items-end pb-1 justify-center"
              style={{ left: `${left}%`, width: `${width}%` }}
            >
            </div>
          );
        })}

        {gridLines.map((line) => (
          <div key={line.key} className="absolute h-full border-l border-dashed border-gray-300" style={{ left: `${line.left}%` }}></div>
        ))}
        <div className="absolute h-full border-l-2 border-red-400" style={{ left: '100%' }}></div>
      </div>
    </div>
  );
});

const GanttChartRow = React.memo(({ task, totalDuration, dragState, onMouseDown, onDoubleClick }) => {
  const nsBars = useMemo(() => 
    generateNSBars(task.ns, totalDuration), 
    [task.ns, totalDuration]
  );
  
  return (
    <div className="border-b border-gray-200 last:border-b-0">
      {/* EX Row */}
      <div className="flex h-12 hover:bg-black/5 transition-colors">
        <div className="w-40 shrink-0 px-4 flex items-center justify-between border-r border-transparent pointer-events-none sticky left-0 z-20 bg-white/90 backdrop-blur-sm">
           <span className="font-bold text-gray-700 truncate mr-2" title={task.name}>{task.name}</span>
           <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1 rounded border border-blue-100">EX</span>
        </div>
        
        <div className="flex-1 relative h-full">
           {task.ex.map((block) => {
              const isDraggingThis = dragState?.type === 'ex' && dragState?.taskId === task.id && dragState?.subId === block.id;
              
              const displayStart = isDraggingThis ? dragState.currentStart : block.start;
              // 表示時間: ドラッグ中は元の時間を維持
              const displayTimeStart = isDraggingThis ? dragState.originalStart : block.start;
              
              const castTime = block.castTime || 0;
              const totalWidthSeconds = castTime + block.duration;
              
              const widthPercent = (totalWidthSeconds / totalDuration) * 100;
              const leftPercent = (displayStart / totalDuration) * 100;
              
              const castWidthPercent = totalWidthSeconds > 0 ? (castTime / totalWidthSeconds) * 100 : 0;

              const remaining = toRemaining(displayTimeStart, totalDuration);
              const isOver = (displayStart + totalWidthSeconds) > totalDuration;

              return (
                <div
                  key={block.id}
                  className={`absolute top-1/2 -translate-y-1/2 h-6 rounded shadow-sm text-xs text-white flex overflow-hidden whitespace-nowrap transition-all ${isOver ? 'opacity-80 ring-2 ring-red-500' : ''} ${dragState ? 'cursor-grabbing' : 'cursor-grab hover:brightness-110'}`}
                  style={{
                    left: `${leftPercent}%`,
                    width: `${widthPercent}%`,
                    minWidth: '4px',
                    zIndex: isDraggingThis ? 50 : 1 
                  }}
                  title={`開始: ${toRemaining(displayTimeStart, totalDuration).toFixed(3)}s / 着弾まで: ${castTime.toFixed(3)}s`}
                  onMouseDown={(e) => onMouseDown(e, task.id, 'ex', block.id)}
                  onDoubleClick={(e) => onDoubleClick(e, task.id, 'ex', block.id)}
                >
                  {/* 詠唱部分 */}
                  {castTime > 0 && (
                      <div 
                        className={`${task.color} h-full opacity-40 bg-[length:4px_4px] bg-[linear-gradient(45deg,rgba(255,255,255,0.4)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.4)_50%,rgba(255,255,255,0.4)_75%,transparent_75%,transparent)]`}
                        style={{ width: `${castWidthPercent}%` }}
                      ></div>
                  )}
                  {/* 効果時間部分 */}
                  <div className={`flex-1 h-full ${task.color} flex items-center justify-center relative`}>
                    <GripHorizontal className="w-3 h-3 mr-1 opacity-50 shrink-0" />
                    <div className="flex items-center gap-1 px-1 drop-shadow-md">
                        <span className="font-bold">{formatTimeFixed(remaining)}</span>
                    </div>
                  </div>
                </div>
              );
           })}
        </div>
      </div>

      {/* NS Row (全遅延のみ) */}
      <div className="flex h-10 transition-colors border-t border-gray-100 border-dashed bg-gray-50/50">
        <div className="w-40 shrink-0 px-4 flex items-center justify-end border-r border-transparent pointer-events-none gap-2 sticky left-0 z-20 bg-gray-50/90 backdrop-blur-sm">
           <span className="text-[10px] font-bold px-1 rounded border text-orange-600 bg-orange-100 border-orange-200">NS</span>
        </div>
        
        <div className="flex-1 relative h-full">
          {nsBars.map((bar) => {
            // 最初のバーだけがドラッグ可能
            const isDraggable = bar.index === 0;
            const isDraggingThis = dragState?.type === 'ns' && dragState?.taskId === task.id;
            
            let displayStart = bar.start;
            if (isDraggingThis) {
                // ドラッグ量 (現在のマウス位置 - ドラッグ開始時のマウス位置相当の開始時間)
                const delta = dragState.currentStart - dragState.originalStart;
                displayStart = bar.start + delta;
            }

            const castTime = bar.castTime || 0;
            const totalWidthSeconds = castTime + bar.duration;

            const widthPercent = (totalWidthSeconds / totalDuration) * 100;
            const leftPercent = (displayStart / totalDuration) * 100;
            const castWidthPercent = totalWidthSeconds > 0 ? (castTime / totalWidthSeconds) * 100 : 0;
            
            // 表示時間: ドラッグ中は元の時間を維持（位置はリアルタイム）
            // NSは常に全遅延なので、連動して動く。
            // ドラッグ中も固定表示するために、計算上の元の位置を表示に使用する
            const originalBaseStart = task.ns.start + (bar.index * task.ns.gap);
            const remaining = toRemaining(isDraggingThis ? originalBaseStart : bar.start, totalDuration);

            if (leftPercent >= 100) return null;

            return (
              <div
                key={bar.index}
                className={`absolute top-1/2 -translate-y-1/2 h-4 rounded-sm text-[10px] text-white flex overflow-hidden whitespace-nowrap ${task.color} ${isDraggable ? (dragState ? 'cursor-grabbing' : 'cursor-grab hover:opacity-80') : 'cursor-default'}`}
                style={{
                  left: `${leftPercent}%`,
                  width: `${widthPercent}%`,
                  opacity: isDraggingThis ? 1.0 : (isDraggable ? 0.8 : 0.6),
                  zIndex: isDraggingThis ? 50 : 1
                }}
                title={`開始: ${remaining.toFixed(3)}s`}
                // isDraggable が true のときのみ onMouseDown を発火
                onMouseDown={(e) => isDraggable && onMouseDown(e, task.id, 'ns', bar.index)}
              >
                {/* 詠唱部分 */}
                {castTime > 0 && (
                    <div 
                      className="h-full bg-white/30"
                      style={{ width: `${castWidthPercent}%` }}
                    ></div>
                )}

                {/* 本体部分 */}
                <div className="flex-1 h-full flex items-center justify-center relative">
                    {/* 最初のバーのみグリップアイコンを表示 */}
                    {isDraggable && (
                        <GripHorizontal className="w-3 h-3 opacity-70 mr-0.5" />
                    )}
                    <span className="font-bold text-[9px] px-0.5">
                        {formatTimeFixed(remaining)}
                    </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
    // パフォーマンス最適化
    if (prevProps.task !== nextProps.task || prevProps.totalDuration !== nextProps.totalDuration) {
        return false;
    }
    const prevDrag = prevProps.dragState;
    const nextDrag = nextProps.dragState;
    if (prevDrag === nextDrag) return true; 

    // ドラッグ中のタスクのみ再レンダリング
    const isRelatedToMe = (drag) => drag && drag.taskId === prevProps.task.id;
    if (isRelatedToMe(prevDrag) || isRelatedToMe(nextDrag)) {
        return false;
    }
    return true; 
});

const TaskControlPanel = React.memo(({ 
  task, totalDuration, 
  onUpdateTaskName, onUpdateTaskProperty, onUpdateExBlock, onAddExBlock, onRemoveExBlock, onUpdateNsConfig,
  onToggleExUnique2, onToggleNsUnique2
}) => {
  return (
    <div className="bg-white border border-gray-200 p-4 rounded-lg shadow-sm h-full flex flex-col">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-100 shrink-0">
        <div className={`w-3 h-3 rounded-full ${task.color} shrink-0`}></div>
        <input 
          type="text" 
          value={task.name}
          onChange={(e) => onUpdateTaskName(task.id, e.target.value)}
          className="font-bold text-gray-700 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none px-1 py-0.5 w-full"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 overflow-y-auto">
        {/* EX 設定エリア */}
        <div className="bg-blue-50/50 p-2 rounded border border-blue-100 flex flex-col">
          <div className="flex items-center justify-between mb-2 shrink-0">
             <span className="text-xs font-bold text-blue-800 bg-blue-100 px-2 py-0.5 rounded flex items-center gap-1">
               <Edit3 className="w-3 h-3" /> EX
             </span>
             <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={task.checkOverlap} 
                  onChange={(e) => onUpdateTaskProperty(task.id, 'checkOverlap', e.target.checked)}
                  className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-xs text-blue-700 font-medium">重複チェック</span>
             </label>
          </div>
          
          <div className="space-y-2 flex-1 overflow-y-auto pr-1">
            {task.ex.map((block, index) => (
              <div key={block.id} className="bg-white p-2 rounded border border-blue-200 shadow-sm relative group">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-gray-400">#{index + 1}</span>
                  <button 
                    onClick={() => onRemoveExBlock(task.id, block.id)}
                    className="text-gray-300 hover:text-red-500 transition-colors"
                    title="このブロックを削除"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                
                <div className="space-y-1">
                  <div className="flex items-center gap-2 justify-between">
                    <div className="flex flex-col gap-1 w-full">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-500 w-12 whitespace-nowrap">開始(指定)</span>
                        <div className="flex items-center gap-1">
                          <TimeInput 
                            className="w-24 px-1 py-0.5"
                            value={toRemaining(block.start, totalDuration)}
                            onChange={(val) => onUpdateExBlock(task.id, block.id, 'startRemaining', val)}
                            max={totalDuration - MIN_ELAPSED_TIME}
                            min={0}
                          />
                          <span className="text-[10px] text-transparent w-3 select-none">s</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-500 w-12 whitespace-nowrap">着弾(秒)</span>
                        <div className="flex items-center gap-1 justify-end w-full">
                          <input
                            type="number"
                            step="0.001"
                            className="w-14 px-1 py-0.5 text-xs border border-gray-300 rounded text-right focus:ring-1 focus:ring-blue-300 outline-none bg-gray-50"
                            value={block.castTime || 0}
                            onChange={(e) => onUpdateExBlock(task.id, block.id, 'castTime', e.target.value)}
                            min={0}
                          />
                          <span className="text-[10px] text-gray-400 w-3">s</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center">
                        <span className="text-[10px] text-gray-500 whitespace-nowrap w-12">長さ</span>
                        <label className="flex items-center gap-0.5 cursor-pointer select-none">
                           <input
                             type="checkbox"
                             className="w-3 h-3 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                             checked={block.isUnique2 || false}
                             onChange={() => onToggleExUnique2(task.id, block.id)}
                           />
                           <span className="text-[9px] text-gray-500">固有2</span>
                        </label>
                    </div>
                    <div className="flex items-center gap-1 justify-end">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-14 px-1 py-0.5 text-xs border border-gray-300 rounded text-right focus:ring-1 focus:ring-blue-300 outline-none"
                        value={block.duration}
                        onChange={(e) => onUpdateExBlock(task.id, block.id, 'duration', e.target.value)}
                      />
                      <span className="text-[10px] text-gray-400 w-3">s</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            
            <button 
              onClick={() => onAddExBlock(task.id)}
              className="w-full py-1.5 flex items-center justify-center gap-1 text-xs font-medium text-blue-600 bg-white border border-blue-200 rounded hover:bg-blue-50 transition-colors mt-2"
            >
              <Plus className="w-3 h-3" /> 追加
            </button>
          </div>
        </div>

        {/* NS 設定エリア */}
        <div className="bg-gray-50 p-2 rounded border border-gray-200 flex flex-col">
          <div className="flex items-center justify-between mb-2">
             <span className="text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1 text-orange-800 bg-orange-100">
               <Settings2 className="w-3 h-3" /> NS
             </span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 justify-between">
              <div className="flex flex-col gap-1 w-full">
                
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 w-16 whitespace-nowrap">開始(秒)</span>
                  <div className="flex items-center gap-1 justify-end w-full">
                    <input
                      type="number"
                      step="0.001"
                      className="w-14 px-1 py-0.5 text-xs border border-gray-300 rounded text-right focus:ring-1 focus:ring-gray-300 outline-none bg-gray-50"
                      value={task.ns.start}
                      onChange={(e) => onUpdateNsConfig(task.id, 'start', e.target.value)}
                      max={totalDuration}
                      min={MIN_ELAPSED_TIME}
                    />
                    <span className="text-[10px] text-gray-400 w-3">s</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 w-16 whitespace-nowrap">着弾(秒)</span>
                  <div className="flex items-center gap-1 justify-end w-full">
                    <input
                      type="number"
                      step="0.001"
                      className="w-14 px-1 py-0.5 text-xs border border-gray-300 rounded text-right focus:ring-1 focus:ring-gray-300 outline-none bg-gray-50"
                      value={task.ns.castTime || 0}
                      onChange={(e) => onUpdateNsConfig(task.id, 'castTime', e.target.value)}
                      min={0}
                    />
                    <span className="text-[10px] text-gray-400 w-3">s</span>
                  </div>
                </div>

              </div>
            </div>
            
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center">
                  <span className="text-xs text-gray-500 whitespace-nowrap w-16">長さ</span>
                  <label className="flex items-center gap-1 cursor-pointer select-none">
                     <input
                       type="checkbox"
                       className="w-3 h-3 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                       checked={task.ns.isUnique2 || false}
                       onChange={() => onToggleNsUnique2(task.id)}
                     />
                     <span className="text-[9px] text-gray-500">固有2</span>
                  </label>
              </div>
              <div className="flex items-center gap-1 justify-end">
                 <input
                   type="number"
                   step="0.01"
                   min="0"
                   className="w-14 px-1 py-0.5 text-xs border border-gray-300 rounded text-right focus:ring-1 focus:ring-gray-300 outline-none"
                   value={task.ns.duration}
                   onChange={(e) => onUpdateNsConfig(task.id, 'duration', e.target.value)}
                />
                <span className="text-[10px] text-gray-400 w-3">s</span>
              </div>
            </div>

            <div className="flex items-center gap-2 justify-between">
              <span className="text-xs text-gray-500 w-16 whitespace-nowrap">間隔</span>
               <div className="flex items-center gap-1 justify-end w-full">
                 <input
                   type="number"
                   step="1"
                   min="0"
                   className="w-14 px-1 py-0.5 text-xs border border-gray-300 rounded text-right focus:ring-1 focus:ring-gray-300 outline-none"
                   value={task.ns.gap}
                   onChange={(e) => onUpdateNsConfig(task.id, 'gap', e.target.value)}
                />
                <span className="text-[10px] text-gray-400 w-3">s</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// --- Main Component ---

export default function App() {
  const [totalDuration, setTotalDuration] = useState(210);
  const [chartTitle, setChartTitle] = useState('チャート1');
  const [tasks, setTasks] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(0); // ズームレベル管理
  
  const currentZoom = useMemo(() => ZOOM_LEVELS[zoomIndex], [zoomIndex]);

  // 初期データ (不要な mode, shifts を削除)
  const initialTasks = useMemo(() => [
    { 
      id: 1, 
      name: 'Striker1', 
      color: 'bg-blue-500', 
      checkOverlap: true,
      ex: [{ id: 'ex-1', start: MIN_ELAPSED_TIME, castTime: 0, duration: 28 }],
      ns: { start: MIN_ELAPSED_TIME, castTime: 0, gap: 30, duration: 10, isUnique2: false } 
    },
    { 
      id: 2, 
      name: 'Striker2', 
      color: 'bg-green-500', 
      checkOverlap: true,
      ex: [{ id: 'ex-2', start: 30, castTime: 0, duration: 45 }],
      ns: { start: MIN_ELAPSED_TIME, castTime: 0, gap: 30, duration: 10, isUnique2: false } 
    },
    { 
      id: 3, 
      name: 'Striker3', 
      color: 'bg-teal-500', 
      checkOverlap: true,
      ex: [{ id: 'ex-3', start: 75, castTime: 0, duration: 45 }],
      ns: { start: MIN_ELAPSED_TIME, castTime: 0, gap: 30, duration: 10, isUnique2: false } 
    },
    { 
      id: 4, 
      name: 'Striker4', 
      color: 'bg-indigo-500', 
      checkOverlap: true,
      ex: [{ id: 'ex-4', start: 120, castTime: 0, duration: 45 }],
      ns: { start: MIN_ELAPSED_TIME, castTime: 0, gap: 30, duration: 10, isUnique2: false } 
    },
    { 
      id: 5, 
      name: 'Special1', 
      color: 'bg-purple-500', 
      checkOverlap: true,
      ex: [{ id: 'ex-5', start: 165, castTime: 0, duration: 30 }],
      ns: { start: MIN_ELAPSED_TIME, castTime: 0, gap: 30, duration: 10, isUnique2: false } 
    },
    { 
      id: 6, 
      name: 'Special2', 
      color: 'bg-rose-500', 
      checkOverlap: true,
      ex: [{ id: 'ex-6', start: 195, castTime: 0, duration: 13 }],
      ns: { start: MIN_ELAPSED_TIME, castTime: 0, gap: 30, duration: 10, isUnique2: false } 
    },
  ], []);

  // --- LocalStorage ロード ---
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedData = window.localStorage.getItem(STORAGE_KEY);
        if (savedData) {
          const parsed = JSON.parse(savedData);
          setTotalDuration(parsed.totalDuration || 210);
          setChartTitle(parsed.chartTitle || 'チャート1');
          if (parsed.tasks && parsed.tasks.length > 0) {
            setTasks(parsed.tasks);
          } else {
            setTasks(initialTasks);
          }
        } else {
          setTasks(initialTasks);
        }
      } catch (error) {
        console.error('Failed to load from local storage', error);
        setTasks(initialTasks);
      } finally {
        setIsLoaded(true);
      }
    }
  }, [initialTasks]);

  // --- LocalStorage 保存 ---
  useEffect(() => {
    if (!isLoaded) return;
    if (typeof window !== 'undefined') {
      const dataToSave = { totalDuration, chartTitle, tasks };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
      } catch (error) {
        console.error('Failed to save to local storage', error);
      }
    }
  }, [totalDuration, chartTitle, tasks, isLoaded]);

  // 編集中のバー情報: { taskId, type, subId, currentTime }
  const [editingBar, setEditingBar] = useState(null);
  
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  // モーダル状態
  const [showImportModal, setShowImportModal] = useState(false);
  const [showOutputModal, setShowOutputModal] = useState(false);
  const [outputText, setOutputText] = useState('');
  const [copied, setCopied] = useState(false);

  const chartRef = useRef(null);
  const headerRef = useRef(null);
  const [dragState, setDragState] = useState(null);
  
  const overlaps = useMemo(() => calculateExOverlaps(tasks, totalDuration), 
    [tasks, totalDuration]
  );

  // --- ハンドラー ---

  const updateTaskProperty = useCallback((taskId, field, value) => {
    setTasks(prev => prev.map(task => task.id === taskId ? { ...task, [field]: value } : task ));
  }, []);

  const updateTaskName = useCallback((taskId, name) => {
    setTasks(prev => prev.map(task => task.id === taskId ? { ...task, name } : task ));
  }, []);

  const addExBlock = useCallback((taskId) => {
    setTasks(prev => prev.map(task => {
      if (task.id === taskId) {
        const lastBlock = task.ex[task.ex.length - 1];
        
        // 直前の値を引き継ぐ
        const duration = lastBlock ? lastBlock.duration : 30;
        const castTime = lastBlock ? (lastBlock.castTime || 0) : 0;
        const isUnique2 = lastBlock ? (lastBlock.isUnique2 || false) : false;
        
        let newStart = lastBlock ? lastBlock.start + duration + castTime + 5 : MIN_ELAPSED_TIME;
        
        if (newStart < MIN_ELAPSED_TIME) newStart = MIN_ELAPSED_TIME;
        
        return { 
            ...task, 
            ex: [ ...task.ex, { id: generateId(), start: newStart, castTime, duration, isUnique2 } ] 
        };
      }
      return task;
    }));
  }, []);

  const removeExBlock = useCallback((taskId, blockId) => {
    setTasks(prev => prev.map(task => 
      task.id === taskId ? { ...task, ex: task.ex.filter(b => b.id !== blockId) } : task 
    ));
  }, []);

  const updateExBlock = useCallback((taskId, blockId, field, value) => {
    setTasks(prev => prev.map(task => {
      if (task.id === taskId) {
        let val = parseFloat(value);
        if (isNaN(val)) val = 0;
        return {
          ...task,
          ex: task.ex.map(b => {
            if (b.id === blockId) {
              if (field === 'startRemaining') {
                return { ...b, start: fromRemaining(val, totalDuration) };
              }
              if (field === 'start') {
                return { ...b, start: val };
              }
              if (field === 'castTime') {
                return { ...b, castTime: val };
              }
              if (field === 'duration') {
                return { ...b, duration: parseFloat(val.toFixed(3)) };
              }
              return { ...b, [field]: Math.max(0, parseInt(val, 10)) };
            }
            return b;
          })
        };
      }
      return task;
    }));
  }, [totalDuration]);

  // EX: 固有2のトグルハンドラ
  const toggleExUnique2 = useCallback((taskId, blockId) => {
    setTasks(prev => prev.map(task => {
      if (task.id === taskId) {
        return {
          ...task,
          ex: task.ex.map(b => {
            if (b.id === blockId) {
              const newIsUnique2 = !b.isUnique2;
              const newDuration = calculateUniqueDuration(b.duration, newIsUnique2);
              return { ...b, isUnique2: newIsUnique2, duration: newDuration };
            }
            return b;
          })
        };
      }
      return task;
    }));
  }, []);

  const updateNsConfig = useCallback((taskId, field, value) => {
    setTasks(prev => prev.map(task => {
      if (task.id === taskId) {
        let safeVal = value;
        // 単純な数値変換のみ
        let val = parseFloat(value);
        if (isNaN(val)) val = 0;
        
        if (field === 'startRemaining') {
          safeVal = fromRemaining(val, totalDuration);
          return { ...task, ns: { ...task.ns, start: safeVal } };
        } else if (field === 'start') {
          safeVal = val;
        } else if (field === 'castTime') { 
          safeVal = val;
        } else if (field === 'duration') {
          safeVal = parseFloat(val.toFixed(3));
        } else {
          safeVal = Math.max(0, parseInt(val, 10));
        }
        
        return { ...task, ns: { ...task.ns, [field]: safeVal } };
      }
      return task;
    }));
  }, [totalDuration]);

  // NS: 固有2のトグルハンドラ
  const toggleNsUnique2 = useCallback((taskId) => {
    setTasks(prev => prev.map(task => {
      if (task.id === taskId) {
        const newIsUnique2 = !task.ns.isUnique2;
        const newDuration = calculateUniqueDuration(task.ns.duration, newIsUnique2);
        return { 
          ...task, 
          ns: { ...task.ns, isUnique2: newIsUnique2, duration: newDuration } 
        };
      }
      return task;
    }));
  }, []);

  const handleBarDoubleClick = useCallback((e, taskId, type, subId) => {
    e.stopPropagation();
    if (type !== 'ex') return;
    const task = tasksRef.current.find(t => t.id === taskId);
    if (!task) return;
    let currentStart = 0;
    const block = task.ex.find(b => b.id === subId);
    if (block) currentStart = block.start;
    setEditingBar({ taskId, type, subId, currentTime: currentStart, taskName: task.name });
  }, []);

  const saveEditedTime = useCallback((newRemaining) => {
    if (!editingBar) return;
    const newStart = fromRemaining(newRemaining, totalDuration);
    updateExBlock(editingBar.taskId, editingBar.subId, 'start', newStart);
  }, [editingBar, totalDuration, updateExBlock]);

  // ドラッグ＆ドロップ実装
  const onMouseDown = useCallback((e, taskId, type, subId) => {
    e.preventDefault();
    e.stopPropagation();

    const task = tasksRef.current.find(t => t.id === taskId);
    if (!task) return;

    let startValue = 0;
    if (type === 'ex') {
        const block = task.ex.find(b => b.id === subId);
        startValue = block ? block.start : 0;
    } else {
        // NS (全遅延のみ: Start)
        startValue = task.ns.start;
    }

    setDragState({
      taskId, type, subId,
      startX: e.clientX,
      originalStart: startValue,
      currentStart: startValue
    });
  }, [totalDuration]);

  const onMouseMove = useCallback((e) => {
    if (!dragState || !chartRef.current) return;
    
    if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
    }

    animationFrameRef.current = requestAnimationFrame(() => {
        // ズーム時の幅計算
        const scrollContainer = chartRef.current;
        const visibleWidth = scrollContainer.getBoundingClientRect().width;
        // スクロールコンテナ内の実際のコンテンツ幅を取得
        const innerDiv = scrollContainer.firstElementChild;
        const actualWidth = innerDiv ? innerDiv.getBoundingClientRect().width : visibleWidth;

        const deltaX = e.clientX - dragState.startX;
        const deltaSeconds = (deltaX / actualWidth) * totalDuration;
        
        let newStart = dragState.originalStart + deltaSeconds;
        newStart = Math.max(MIN_ELAPSED_TIME, newStart);
        
        setDragState(prev => ({ ...prev, currentStart: newStart }));
    });
  }, [dragState, totalDuration]);

  const onMouseUp = useCallback(() => {
    if (!dragState) return;
    if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
    }
    
    const { taskId, type, subId, currentStart } = dragState;
    
    if (type === 'ex') {
        setTasks(prev => prev.map(t => {
            if (t.id === taskId) {
                return {
                    ...t,
                    ex: t.ex.map(b => {
                        if (b.id === subId) {
                            return { ...b, start: currentStart };
                        }
                        return b;
                    })
                };
            }
            return t;
        }));

    } else {
        // NS (全遅延): 開始時間を更新
        const task = tasksRef.current.find(t => t.id === taskId);
        if (task) {
            const barIndex = subId; // NSの場合subIdにindexが入っている
            const gap = task.ns.gap || 30;
            
            // 全体の開始時間 = 現在のバー位置 - (index * gap)
            let newStart = currentStart - (barIndex * gap);
            newStart = Math.max(MIN_ELAPSED_TIME, newStart);
            updateNsConfig(taskId, 'start', newStart);
        }
    }
    
    setDragState(null);
  }, [dragState, updateNsConfig, totalDuration]);

  // アニメーションフレーム参照
  const animationFrameRef = useRef(null);

  useEffect(() => {
    if (dragState) {
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    } else {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    }
    return () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        if (animationFrameRef.current) {
             cancelAnimationFrame(animationFrameRef.current);
        }
    };
  }, [dragState, onMouseMove, onMouseUp]);

  // スクロール同期
  const handleScroll = () => {
    if (chartRef.current && headerRef.current) {
      headerRef.current.scrollLeft = chartRef.current.scrollLeft;
    }
  };

  // データインポート
  const handleImport = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;

      const lines = text.split(/\r\n|\n/).map(line => line.trim()).filter(line => line !== '');
      if (lines.length > 0) {
        if (window.confirm(`${lines.length}件のタスクリストを読み込みますか？(新規作成)`)) {
            const importedTasks = lines.map((line, index) => {
                // カンマ区切りでパース
                const parts = line.split(',').map(p => p.trim());
                
                const name = parts[0] || `Task ${index + 1}`;
                const nsStart = parseFloat(parts[1]);
                const nsCast = parseFloat(parts[2]);
                const nsDuration = parseFloat(parts[3]);
                const nsGap = parseFloat(parts[4]);

                const safeStart = !isNaN(nsStart) ? nsStart : MIN_ELAPSED_TIME;
                const safeCast = !isNaN(nsCast) ? nsCast : 0;
                const safeDuration = !isNaN(nsDuration) ? nsDuration : 20;
                const safeGap = !isNaN(nsGap) ? nsGap : 30;

                return {
                    id: generateId(),
                    name: name,
                    color: COLORS[index % COLORS.length],
                    checkOverlap: true,
                    ex: [],
                    ns: { 
                       start: safeStart, 
                       castTime: safeCast,
                       duration: safeDuration, 
                       gap: safeGap, 
                       enabled: true, 
                       isUnique2: false
                    }
                };
            });
            
            setTasks(importedTasks);
            setShowImportModal(false);
        }
      } else {
        alert('読み込めるデータが見つかりませんでした。改行区切りのテキストファイルを選択してください。');
      }
    };
    reader.readAsText(file);
  };

  const generateOutput = () => {
    const lines = [];
    lines.push(chartTitle); // チャート名
    lines.push(''); // 空行
    
    const allEvents = [];
    
    tasks.forEach(task => {
        task.ex.forEach(block => {
            allEvents.push({
                time: toRemaining(block.start, totalDuration),
                name: task.name,
                type: 'EX',
                duration: block.duration
            });
        });
    });
    
    allEvents.sort((a, b) => b.time - a.time);
    
    allEvents.forEach(evt => {
        lines.push(`${formatTimeFixed(evt.time)} ${evt.name}`);
    });
    
    setOutputText(lines.join('\n'));
    setShowOutputModal(true);
    setCopied(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(outputText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const resetData = () => {
    if (window.confirm('全てのデータを初期状態に戻しますか？')) {
        setTasks(initialTasks);
        setTotalDuration(210);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-gray-800 font-sans" ref={containerRef}>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0 shadow-sm z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-blue-600">
            <BarChart3 className="w-6 h-6" />
            <h1 className="text-xl font-bold tracking-tight">BAchart</h1>
          </div>
          <div className="h-6 w-px bg-gray-300 mx-2"></div>
          <input 
            type="text" 
            value={chartTitle} 
            onChange={(e) => setChartTitle(e.target.value)} 
            className="text-lg font-bold text-gray-700 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none"
          />
        </div>
        
        <div className="flex items-center gap-3">
          {/* Zoom Control */}
          <div className="flex items-center gap-2 bg-gray-100 px-3 py-1.5 rounded-lg mr-2 border border-gray-200">
             <button
               onClick={() => setZoomIndex(Math.max(0, zoomIndex - 1))}
               disabled={zoomIndex === 0}
               className="p-1 rounded-md hover:bg-gray-200 disabled:opacity-30 transition-colors"
             >
               <ZoomOut className="w-4 h-4 text-gray-600" />
             </button>
             
             <div className="flex flex-col items-center w-20">
                <div className="flex gap-0.5 h-1.5 w-full bg-gray-300 rounded-full overflow-hidden">
                   {ZOOM_LEVELS.map((_, i) => (
                      <div 
                        key={i} 
                        className={`flex-1 transition-colors ${i <= zoomIndex ? 'bg-blue-500' : 'bg-transparent'}`}
                      />
                   ))}
                </div>
                <span className="text-[10px] font-bold text-gray-600 mt-0.5">{currentZoom.label}</span>
             </div>

             <button
               onClick={() => setZoomIndex(Math.min(ZOOM_LEVELS.length - 1, zoomIndex + 1))}
               disabled={zoomIndex === ZOOM_LEVELS.length - 1}
               className="p-1 rounded-md hover:bg-gray-200 disabled:opacity-30 transition-colors"
             >
               <ZoomIn className="w-4 h-4 text-gray-600" />
             </button>
          </div>

          <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg mr-2">
             {TIME_OPTIONS.map(opt => (
               <button
                 key={opt.value}
                 onClick={() => setTotalDuration(opt.value)}
                 className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${totalDuration === opt.value ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
               >
                 {opt.label}
               </button>
             ))}
          </div>
          
          <button onClick={() => setShowImportModal(true)} className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
            <Upload className="w-4 h-4" /> 読込
          </button>
          <button onClick={generateOutput} className="flex items-center gap-1 px-3 py-1.5 text-sm font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700 shadow-sm">
            <List className="w-4 h-4" /> 出力
          </button>
          <button onClick={resetData} className="p-2 text-gray-400 hover:text-red-500 transition-colors" title="初期化">
            <Database className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area (Vertical Split) */}
      <div className="flex flex-1 flex-col overflow-hidden">
        
        {/* 1. Chart Area (Top, Auto height to fit content) */}
        <div className="flex-none flex flex-col bg-slate-50/50 relative border-b-4 border-gray-200 shrink-0" style={{ maxHeight: '60%' }}>
           
           {/* Chart Header (Scale) - Scroll synced */}
           <div ref={headerRef} className="h-8 bg-white border-b border-gray-200 flex shrink-0 select-none overflow-hidden">
              <div style={{ width: `${currentZoom.scale * 100}%`, minWidth: '100%' }} className="flex h-full relative">
                  {/* Sticky Task Name Column */}
                  <div className="w-40 shrink-0 sticky left-0 z-30 bg-white border-r border-gray-200 flex items-center justify-center">
                     <span className="text-xs font-bold text-gray-400">Member</span>
                  </div>
                  
                  {/* Scale Container */}
                  <div className="flex-1 relative h-full">
                     {/* Scale Markers */}
                     {Array.from({ length: Math.floor(totalDuration / currentZoom.interval) + 1 }).map((_, i) => {
                        const elapsed = i * currentZoom.interval;
                        const left = (elapsed / totalDuration) * 100;
                        const remaining = toRemaining(elapsed, totalDuration);
                        if (left > 100) return null;
                        return (
                            <div key={i} className="absolute top-0 bottom-0 border-l border-gray-200 flex flex-col justify-end pb-1" style={{ left: `${left}%` }}>
                                <span className="text-[10px] text-gray-400 pl-1 -ml-px tabular-nums">
                                    {formatTime(remaining)}
                                </span>
                            </div>
                        );
                     })}
                  </div>
              </div>
           </div>

           {/* Chart Body - Scrollable */}
           <div ref={chartRef} onScroll={handleScroll} className="overflow-auto relative" style={{ height: 'auto' }}>
              <div style={{ width: `${currentZoom.scale * 100}%`, minWidth: '100%' }} className="relative min-h-full">
                <GanttBackground 
                   totalDuration={totalDuration} 
                   overlaps={overlaps} 
                   isDragging={!!dragState}
                   tickInterval={currentZoom.interval}
                />
                
                <div className="relative z-10">
                   {tasks.map(task => (
                     <GanttChartRow 
                       key={task.id}
                       task={task}
                       totalDuration={totalDuration}
                       dragState={dragState}
                       onMouseDown={onMouseDown}
                       onDoubleClick={handleBarDoubleClick}
                     />
                   ))}
                </div>
              </div>
           </div>
        </div>

        {/* 2. Settings Area (Bottom, Scrollable) */}
        <div className="flex-1 overflow-y-auto bg-white p-4">
           <div className="container mx-auto">
             
             {/* Grid Layout for Panels */}
             <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-10">
                {tasks.map(task => (
                  <div key={task.id} className="h-96"> {/* 高さを固定してスクロールしやすくする */}
                    <TaskControlPanel 
                      task={task} 
                      totalDuration={totalDuration}
                      onUpdateTaskName={updateTaskName}
                      onUpdateTaskProperty={updateTaskProperty}
                      onUpdateExBlock={updateExBlock}
                      onAddExBlock={addExBlock}
                      onRemoveExBlock={removeExBlock}
                      onUpdateNsConfig={updateNsConfig}
                      onToggleExUnique2={toggleExUnique2}
                      onToggleNsUnique2={toggleNsUnique2}
                    />
                  </div>
                ))}
             </div>
           </div>
        </div>

      </div>

      {/* インポートモーダル */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="bg-slate-800 p-3 text-white flex justify-between items-center">
              <h2 className="font-bold text-sm flex items-center gap-2"><Upload className="w-4 h-4"/> テキストファイルの読み込み</h2>
              <button onClick={() => setShowImportModal(false)}><X className="w-4 h-4"/></button>
            </div>
            <div className="p-6">
              
              <div className="mb-6 bg-slate-50 p-4 rounded-lg border border-slate-200">
                <p className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-1">
                   <FileText className="w-4 h-4" />
                   書き方の例 (sample.txt)
                </p>
                <div className="bg-white p-3 rounded border border-gray-300 font-mono text-xs text-gray-600 leading-relaxed">
                   # 書式: タスク名, 開始(秒), 着弾(秒), 長さ(秒), 間隔(秒)<br/>
                   <br/>
                   Striker1, 2, 0, 20, 30<br/>
                   Striker2, 30, 0, 20, 30<br/>
                   Healer, 2, 2.5, 15, 60<br/>
                   Tank1, 5, 0, 10, 45
                </div>
                <p className="mt-2 text-xs text-gray-500">
                   ※ 1行につき1つのタスクとして読み込まれます。<br/>
                   ※ カンマ(,)で区切って数値を指定してください。省略時はデフォルト値が適用されます。
                </p>
              </div>

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 flex flex-col items-center justify-center bg-gray-50 hover:bg-blue-50 transition-colors cursor-pointer relative group">
                <Upload className="w-8 h-8 text-gray-400 mb-2 group-hover:text-blue-500" />
                <p className="text-sm font-medium text-gray-600 mb-1">ファイルをここにドロップ</p>
                <p className="text-xs text-gray-400">または クリックして選択</p>
                <input 
                  type="file" 
                  accept=".txt"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={handleImport}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 出力モーダル */}
      {showOutputModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="bg-slate-800 p-3 text-white flex justify-between items-center shrink-0">
              <h2 className="font-bold text-sm flex items-center gap-2"><List className="w-4 h-4"/> スキル回し出力</h2>
              <button onClick={() => setShowOutputModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-6 flex-1 overflow-y-auto">
              <div className="mb-2 flex justify-between items-center">
                <p className="text-sm font-bold text-gray-700">出力結果 (残り時間順) ※EXのみ</p>
                <button 
                  onClick={copyToClipboard}
                  className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'コピーしました' : 'クリップボードにコピー'}
                </button>
              </div>
              <textarea
                readOnly
                value={outputText}
                className="w-full h-64 border border-gray-300 rounded-lg p-3 text-sm font-mono focus:ring-2 focus:ring-blue-400 outline-none bg-gray-50"
              />
            </div>
          </div>
        </div>
      )}

      {/* 時間編集モーダル */}
      {editingBar && (
        <EditTimeModal 
          initialValue={toRemaining(editingBar.currentTime, totalDuration)}
          title={`${editingBar.taskName} - 開始時間の変更`}
          totalDuration={totalDuration}
          onSave={saveEditedTime}
          onClose={() => setEditingBar(null)}
        />
      )}

    </div>
  );
}
