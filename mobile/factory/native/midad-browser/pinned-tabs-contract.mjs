const unique = values => [...new Set((Array.isArray(values)?values:[]).filter(v=>typeof v==="string"&&v.length>0))];
export function pinTab(pinnedIds, id){return unique([...pinnedIds,id]);}
export function unpinTab(pinnedIds,id){return unique(pinnedIds).filter(v=>v!==id);}
export function canCloseTab(pinnedIds,id){return !unique(pinnedIds).includes(id);}
export function orderTabIds(tabIds,pinnedIds){const p=new Set(unique(pinnedIds));return [...tabIds.filter(id=>p.has(id)),...tabIds.filter(id=>!p.has(id))];}
export function restorePinnedState(tabIds,pinnedIds){const valid=new Set(tabIds);return unique(pinnedIds).filter(id=>valid.has(id)).sort((a,b)=>tabIds.indexOf(a)-tabIds.indexOf(b));}
export function serializePinnedState(tabIds,pinnedIds){return {version:1,pinnedIds:restorePinnedState(tabIds,pinnedIds)};}
