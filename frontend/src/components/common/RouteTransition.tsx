import { ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { transitions } from '../../design-system/tokens/transitions';

interface RouteTransitionProps {
  children: ReactNode;
}

/**
 * Smooth route transition wrapper
 * Adds fade-in animation when route changes
 */
export const RouteTransition = ({ children }: RouteTransitionProps) => {
  const location = useLocation();
  const [displayLocation, setDisplayLocation] = useState(location);
  const [transitionStage, setTransitionStage] = useState<'fade-in' | 'fade-out'>('fade-in');

  useEffect(() => {
    if (location !== displayLocation) {
      setTransitionStage('fade-out');
    }
  }, [location, displayLocation]);

  return (
    <div
      style={{
        animation: transitionStage === 'fade-in'
          ? 'pageContentFadeIn 400ms cubic-bezier(0.16, 1, 0.3, 1)'
          : 'none',
        opacity: transitionStage === 'fade-out' ? 0 : 1,
        transition: transitions.fadeIn
      }}
      onAnimationEnd={() => {
        if (transitionStage === 'fade-out') {
          setTransitionStage('fade-in');
          setDisplayLocation(location);
        }
      }}
    >
      {children}
    </div>
  );
};
