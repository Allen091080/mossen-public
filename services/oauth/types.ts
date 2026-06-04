export type BillingType =
  | 'api'
  | 'card'
  | 'invoice'
  | 'manual'
  | 'none'
  | string

export type SubscriptionType =
  | 'free'
  | 'pro'
  | 'max'
  | 'team'
  | 'enterprise'
  | string

export type RateLimitTier =
  | 'default'
  | 'default_mossen_max_5x'
  | 'enterprise'
  | string

export type OAuthOrganizationProfile = {
  uuid: string
  name?: string | null
  has_extra_usage_enabled?: boolean | null
  billing_type?: BillingType | null
  organization_type?: string | null
  rate_limit_tier?: RateLimitTier | null
  subscription_created_at?: string | null
}

export type OAuthProfileResponse = {
  account: {
    uuid: string
    email: string
    display_name?: string | null
    created_at?: string | null
  }
  organization: OAuthOrganizationProfile
}

export type OAuthTokenAccount = {
  uuid: string
  emailAddress: string
  organizationUuid: string
}

export type OAuthTokenExchangeAccount = {
  uuid: string
  email_address: string
}

export type OAuthTokenExchangeResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  account?: OAuthTokenExchangeAccount
  organization?: {
    uuid?: string
  }
  subscription_type?: SubscriptionType | null
  rate_limit_tier?: RateLimitTier | null
}

export type OAuthTokens = {
  accessToken: string
  refreshToken?: string | null
  expiresAt?: number | null
  scopes?: string[]
  profile?: OAuthProfileResponse
  tokenAccount?: OAuthTokenAccount
  subscriptionType?: SubscriptionType | null
  rateLimitTier?: RateLimitTier | null
}

export type UserRolesResponse = {
  roles?: string[]
  organization_role?: string
  workspace_role?: string
  organization_name?: string
}

export type ReferralCampaign = 'mossen_guest_pass' | string

export type ReferralCodeDetails = {
  referral_link?: string
  campaign?: ReferralCampaign
}

export type ReferralEligibilityResponse = {
  eligible: boolean
  referral_code_details?: ReferralCodeDetails | null
  referrer_reward?: ReferrerRewardInfo | null
  remaining_passes?: number
  availablePasses?: number
}

export type ReferrerRewardInfo = {
  amount_minor_units: number
  currency: string
  credits?: number
  description?: string
}

export type ReferralRedemptionsResponse = {
  limit?: number
  redemptions?: Array<{
    id?: string
    redeemedAt?: string
    email?: string
    status?: string
  }>
}
