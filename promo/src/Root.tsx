import React from 'react';
import { Composition } from 'remotion';
import { ClarityPromo } from './ClarityPromo';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ClarityPromo"
      component={ClarityPromo}
      durationInFrames={900}
      fps={30}
      width={1280}
      height={720}
    />
  );
};
