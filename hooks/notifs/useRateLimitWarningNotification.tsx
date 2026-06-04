/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { Text } from 'src/ink.js';
import { getRateLimitWarning, getUsingOverageText } from 'src/services/hostedLimits.js';
import { useHostedLimits } from 'src/services/hostedLimitsHook.js';
import { getSubscriptionType } from 'src/utils/auth.js';
import { hasHostedBillingAccess } from 'src/utils/billing.js';
import { getIsRemoteMode } from '../../bootstrap/state.js';
export function useRateLimitWarningNotification(model) {
  const $ = _c(17);
  const {
    addNotification
  } = useNotifications();
  const hostedLimits = useHostedLimits();
  let t0;
  if ($[0] !== hostedLimits || $[1] !== model) {
    t0 = getRateLimitWarning(hostedLimits, model);
    $[0] = hostedLimits;
    $[1] = model;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  const rateLimitWarning = t0;
  let t1;
  if ($[3] !== hostedLimits) {
    t1 = getUsingOverageText(hostedLimits);
    $[3] = hostedLimits;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  const usingOverageText = t1;
  const shownWarningRef = useRef(null);
  let t2;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = getSubscriptionType();
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  const subscriptionType = t2;
  let t3;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = hasHostedBillingAccess();
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  const hasBillingAccess = t3;
  const isTeamOrEnterprise = subscriptionType === "team" || subscriptionType === "enterprise";
  const [hasShownOverageNotification, setHasShownOverageNotification] = useState(false);
  let t4;
  let t5;
  if ($[7] !== addNotification || $[8] !== hostedLimits.isUsingOverage || $[9] !== hasShownOverageNotification || $[10] !== usingOverageText) {
    t4 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (hostedLimits.isUsingOverage && !hasShownOverageNotification && (!isTeamOrEnterprise || hasBillingAccess)) {
        addNotification({
          key: "limit-reached",
          text: usingOverageText,
          priority: "immediate"
        });
        setHasShownOverageNotification(true);
      } else {
        if (!hostedLimits.isUsingOverage && hasShownOverageNotification) {
          setHasShownOverageNotification(false);
        }
      }
    };
    t5 = [hostedLimits.isUsingOverage, usingOverageText, hasShownOverageNotification, addNotification, hasBillingAccess, isTeamOrEnterprise];
    $[7] = addNotification;
    $[8] = hostedLimits.isUsingOverage;
    $[9] = hasShownOverageNotification;
    $[10] = usingOverageText;
    $[11] = t4;
    $[12] = t5;
  } else {
    t4 = $[11];
    t5 = $[12];
  }
  useEffect(t4, t5);
  let t6;
  let t7;
  if ($[13] !== addNotification || $[14] !== rateLimitWarning) {
    t6 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (rateLimitWarning && rateLimitWarning !== shownWarningRef.current) {
        shownWarningRef.current = rateLimitWarning;
        addNotification({
          key: "rate-limit-warning",
          jsx: <Text><Text color="warning">{rateLimitWarning}</Text></Text>,
          priority: "high"
        });
      }
    };
    t7 = [rateLimitWarning, addNotification];
    $[13] = addNotification;
    $[14] = rateLimitWarning;
    $[15] = t6;
    $[16] = t7;
  } else {
    t6 = $[15];
    t7 = $[16];
  }
  useEffect(t6, t7);
}
