import { query } from './db.js';

function config(){
  const baseUrl=(process.env.TUKU_CORE_INTERNAL_URL||process.env.TUKU_CORE_URL||'').replace(/\/$/,'');
  const key=process.env.TUKU_AI_INTEGRATION_KEY;
  return baseUrl&&key?{baseUrl,key}:null;
}
async function call(path,body){
  const cfg=config(); if(!cfg)return null;
  const response=await fetch(`${cfg.baseUrl}/api/v1/integrations/ai${path}`,{method:'POST',headers:{'content-type':'application/json','x-tuku-product-code':'traffiq','x-tuku-integration-key':cfg.key},body:JSON.stringify(body),signal:AbortSignal.timeout(90_000)});
  if(!response.ok)return null;
  const json=await response.json().catch(()=>null); return json?.data??json;
}
export async function journeyEvidence(userId,journeyId){
  const journeys=await query(`SELECT id,mode,status,journey_role,purpose,origin_name,destination_name,distance_m,duration_s,avg_speed_mps,max_speed_mps,started_at,ended_at,created_at,updated_at FROM journeys WHERE id=$1 AND user_id=$2 LIMIT 1`,[journeyId,userId]);
  if(!journeys.rowCount)return null;
  const [points,incidents]=await Promise.all([
    query(`SELECT count(*)::int point_count, min(recorded_at) first_point_at,max(recorded_at) last_point_at,avg(speed_mps) FILTER(WHERE speed_mps IS NOT NULL) avg_recorded_speed_mps,max(speed_mps) max_recorded_speed_mps,avg(accuracy_m) FILTER(WHERE accuracy_m IS NOT NULL) avg_accuracy_m FROM journey_points WHERE journey_id=$1`,[journeyId]),
    query(`SELECT count(*)::int incident_count,count(*) FILTER(WHERE severity IN ('high','critical'))::int high_incidents,jsonb_agg(jsonb_build_object('type',type,'severity',severity,'occurredAt',occurred_at,'confirmations',confirmations,'disputes',disputes) ORDER BY occurred_at DESC) FILTER(WHERE id IS NOT NULL) incidents FROM incidents WHERE journey_id=$1 AND user_id=$2`,[journeyId,userId])
  ]);
  return {journey:journeys.rows[0],telemetry:points.rows[0]??{},incidents:incidents.rows[0]??{}};
}
export async function assistJourney(userId,journeyId,question){
  const evidence=await journeyEvidence(userId,journeyId); if(!evidence)return null;
  return call('/assist',{capability:'recommend',instruction:question?.trim()||'Act as the TraffIQ journey intelligence coach. Give a concise evidence-grounded journey summary, identify safety or data-quality concerns, and suggest useful future travel habits. Do not infer accidents, violations, road conditions, traffic causes, exact route quality or driver intent unless directly supported by supplied evidence. Never replace routing or emergency logic.',context:{evidence},subjectRef:`traffiq-journey:${journeyId}`});
}
export async function queueJourneyReview(userId,journeyId){
  const evidence=await journeyEvidence(userId,journeyId); if(!evidence)return null;
  return call('/jobs',{jobType:'traffiq.completed-journey-review',capability:'analyze',instruction:'Review this completed TraffIQ journey for travel-pattern insight, telemetry quality, unusual speed patterns, recorded incidents and practical future journey recommendations. Be conservative about safety conclusions and never invent road conditions or incidents.',context:{evidence},subjectRef:`traffiq-journey:${journeyId}`});
}
