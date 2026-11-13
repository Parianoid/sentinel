"use client";
import { CircleHelp } from "lucide-react";
export default function TourLauncher(){return <button className="tourReplay" onClick={()=>{if(window.location.pathname!=="/queue")window.location.href="/queue?tour=1";else window.dispatchEvent(new Event("sentinel:replay-tour"));}}><CircleHelp size={15}/>How it works</button>}
