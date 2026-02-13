'use client';

import './story.css';
import { Prologue } from './Prologue';
import { OldWorld } from './OldWorld';
import { Architects } from './Architects';
import { Collapse } from './Collapse';
import { Protocol } from './Protocol';
import { Economics } from './Economics';
import { CastSection } from './CastSection';
import { LiveAgents } from './LiveAgents';
import { WhatYouCanDo } from './WhatYouCanDo';
import { Epilogue } from './Epilogue';

export function StoryPage() {
  return (
    <div className="bg-void min-h-screen">
      <Prologue />
      <OldWorld />
      <Architects />
      <Collapse />
      <Protocol />
      <CastSection />
      <LiveAgents />
      <Economics />
      <WhatYouCanDo />
      <Epilogue />
    </div>
  );
}
