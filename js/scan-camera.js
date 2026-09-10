// Live framing only. Pose inference still runs on the captured photo during review.
// No microphone, upload, recording, localStorage or persistent frame buffer.
const SCAN_CAMERAS=new Set();
function stopScanCameras(){for(const camera of [...SCAN_CAMERAS])camera.stop();}
function createScanCamera({video,isCurrent,authorize,onState=()=>{}}){
  let stream=null,closed=false,epoch=0,phase='idle',watch=null,timeout=null;
  const status=(state,message)=>{phase=state;onState({state,message});};
  const current=()=>!closed&&video.isConnected&&isCurrent()&&!document.hidden;
  const release=()=>{
    if(stream){for(const track of stream.getTracks()){track.removeEventListener?.('ended',ended);try{track.stop();}catch(_){}}stream=null;}
    try{video.pause();}catch(_){}
    video.srcObject=null;
  };
  const hidden=()=>{if(document.hidden)stop('Camera stopped while the app was in the background.');};
  const left=()=>stop('Camera stopped.');
  const ended=()=>stop('The camera disconnected. Open it again or use the camera app.');
  function stop(message='Camera is off.'){
    if(closed)return;closed=true;epoch++;
    clearInterval(watch);clearTimeout(timeout);watch=null;timeout=null;
    document.removeEventListener('visibilitychange',hidden);
    window.removeEventListener('pagehide',left);window.removeEventListener('hashchange',left);
    release();SCAN_CAMERAS.delete(api);status('stopped',message);
  }
  async function start(){
    if(closed||phase!=='idle')return false;
    const request=++epoch;
    status('starting','Allow camera access to preview this view.');
    document.addEventListener('visibilitychange',hidden);
    window.addEventListener('pagehide',left);window.addEventListener('hashchange',left);
    watch=setInterval(()=>{if(!current())stop('Camera stopped because the scan is no longer active.');},250);
    // A browser permission prompt may remain unanswered indefinitely. Late grants
    // are stopped below, even when this timeout has already closed the controller.
    timeout=setTimeout(()=>stop('The camera did not open. Try again or use the camera app.'),30000);
    try{
      if(!current()||!(await authorize())||!current())throw Error('scan_permission');
      if(!navigator.mediaDevices?.getUserMedia)throw Error('camera_unsupported');
      const granted=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1200},height:{ideal:1600}}});
      if(request!==epoch||!current()){for(const track of granted.getTracks())track.stop();stop();return false;}
      stream=granted;
      // Recheck the release after the potentially long browser permission prompt.
      if(!(await authorize())||request!==epoch||!current())throw Error('scan_permission');
      for(const track of stream.getTracks())track.addEventListener?.('ended',ended,{once:true});
      video.muted=true;video.playsInline=true;video.srcObject=stream;
      await video.play();
      if(request!==epoch||!current()){stop();return false;}
      if(!(video.videoWidth>0&&video.videoHeight>0))throw Error('camera_no_frame');
      clearTimeout(timeout);timeout=null;
      status('ready','Camera ready. Keep the whole body visible, then take the photo.');
      return true;
    }catch(error){
      if(request!==epoch||closed)return false;
      const messages={scan_permission:'Scan permission changed. Close this scan and start again.',camera_unsupported:'Live camera is unavailable here. Use the camera app button.',NotAllowedError:'Camera access was not allowed. Use the camera app or enable camera access in your browser.',NotFoundError:'No camera was found. Use another device or choose a photo.',NotReadableError:'The camera is busy or unavailable. Close other camera apps and retry.'};
      stop(messages[error.message]||messages[error.name]||'The camera could not start. Try again or use the camera app.');return false;
    }
  }
  async function capture(){
    if(phase!=='ready'||!current())return null;
    const request=epoch;status('capturing','Taking photo…');
    let canvas=null;
    try{
      if(!(await authorize())||request!==epoch||!current())throw Error('scan_permission');
      const width=video.videoWidth,height=video.videoHeight;
      if(!(Number.isFinite(width)&&width>0&&Number.isFinite(height)&&height>0))throw Error('camera_no_frame');
      const scale=Math.min(1,1600/Math.max(width,height));
      canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
      // Full source frame, no silhouette crop or horizontal reflection.
      canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
      release();
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));
      if(request!==epoch||!current())return null;
      if(!blob)throw Error('camera_encode');
      stop('Photo captured.');return blob;
    }catch(error){
      if(!closed)stop(error.message==='scan_permission'?'Scan permission changed. Close this scan and start again.':'The photo could not be captured. Open the camera to retry.');
      return null;
    }finally{if(canvas)canvas.width=canvas.height=0;}
  }
  const api={start,capture,stop,isReady:()=>phase==='ready',isStarting:()=>phase==='starting'};
  SCAN_CAMERAS.add(api);return api;
}
