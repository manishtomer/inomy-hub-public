"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { parseUnits, encodeFunctionData } from "viem";

type AgentType = "CATALOG" | "REVIEW" | "CURATION" | "SELLER";
type Personality = "conservative" | "balanced" | "aggressive" | "opportunistic";

// USDC contract on Monad Testnet
const USDC_ADDRESS = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const USDC_DECIMALS = 6;
const CHAIN_ID = 10143;
const REGISTRATION_FEE_USDC = 1.0; // Platform registration fee
const MIN_SEED_USDC = 1.5; // 0.5 min operational + 1.0 registration fee
const PLATFORM_WALLET = "0x94AE63aD0A6aB42e1688CCe578D0DD8b4A2B24e2"; // Deployer / cost sink

// ERC20 ABI for transfer function
const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

interface FormData {
  name: string;
  tokenSymbol: string;
  type: AgentType;
  personality: Personality;
  description: string;
  seedAmount: string; // USDC amount
  initialBuyAmount: string; // MON for initial token buy on nad.fun
}

const AGENT_TYPES: { value: AgentType; label: string; description: string }[] = [
  {
    value: "CATALOG",
    label: "Catalog Agent",
    description: "Extracts and enriches product data from various sources",
  },
  {
    value: "REVIEW",
    label: "Review Agent",
    description: "Analyzes and aggregates product reviews and sentiment",
  },
  {
    value: "CURATION",
    label: "Curation Agent",
    description: "Creates personalized product collections and recommendations",
  },
  {
    value: "SELLER",
    label: "Seller Agent",
    description: "Manages inventory and handles sales transactions",
  },
];

const PERSONALITIES: { value: Personality; label: string; description: string }[] = [
  {
    value: "conservative",
    label: "Conservative",
    description: "Low-risk bids, prioritizes reliability over profit margin",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Moderate risk tolerance, balances profit and success rate",
  },
  {
    value: "aggressive",
    label: "Aggressive",
    description: "Higher bids for better margins, accepts more risk",
  },
  {
    value: "opportunistic",
    label: "Opportunistic",
    description: "Adapts strategy based on market conditions",
  },
];

export default function CreateAgentPage() {
  const router = useRouter();
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();

  const [step, setStep] = useState<"form" | "confirm" | "creating" | "signing" | "confirming" | "funding" | "complete">("form");
  const [formData, setFormData] = useState<FormData>({
    name: "",
    tokenSymbol: "",
    type: "CATALOG",
    personality: "balanced",
    description: "",
    seedAmount: "1.5",
    initialBuyAmount: "0.1",
  });
  const [error, setError] = useState<string | null>(null);
  const [createdAgent, setCreatedAgent] = useState<any>(null);

  const connectedWallet = wallets[0];

  const handleInputChange = (field: keyof FormData, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  const validateForm = (): boolean => {
    if (!formData.name.trim()) {
      setError("Agent name is required");
      return false;
    }
    if (formData.name.length < 3) {
      setError("Agent name must be at least 3 characters");
      return false;
    }
    if (!formData.tokenSymbol.trim()) {
      setError("Token symbol is required");
      return false;
    }
    if (formData.tokenSymbol.length > 6) {
      setError("Token symbol must be 6 characters or less");
      return false;
    }
    if (!/^[A-Za-z]+$/.test(formData.tokenSymbol)) {
      setError("Token symbol must be letters only");
      return false;
    }
    if (!formData.description.trim()) {
      setError("Description is required");
      return false;
    }
    const seedAmount = parseFloat(formData.seedAmount);
    if (isNaN(seedAmount) || seedAmount < MIN_SEED_USDC) {
      setError(`Minimum seed is ${MIN_SEED_USDC} USDC ($${REGISTRATION_FEE_USDC} platform fee + $${MIN_SEED_USDC - REGISTRATION_FEE_USDC} operating funds)`);
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    if (!authenticated) {
      login();
      return;
    }
    if (!connectedWallet) {
      setError("Please connect your wallet first");
      return;
    }
    setStep("confirm");
  };

  const handleConfirm = async () => {
    if (!connectedWallet) return;

    try {
      setStep("creating");
      setError(null);

      const provider = await connectedWallet.getEthereumProvider();

      // Step 1: Create agent + prepare nad.fun TX (server-side)
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          type: formData.type,
          symbol: formData.tokenSymbol.toUpperCase(),
          personality: formData.personality,
          description: formData.description,
          ownerWallet: connectedWallet.address,
          initialBuyAmount: formData.initialBuyAmount,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to create agent");
      }

      setCreatedAgent(data);
      const agentId = data.data.id;
      const transaction = data.transaction;

      if (!transaction) {
        throw new Error("Server did not return nad.fun transaction data");
      }

      // Step 2: User signs nad.fun BondingCurveRouter.create() TX
      setStep("signing");

      const createTxHash = await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from: connectedWallet.address,
          to: transaction.to,
          data: transaction.data,
          value: "0x" + BigInt(transaction.value).toString(16),
          chainId: "0x" + CHAIN_ID.toString(16),
        }],
      });

      console.log("nad.fun create TX:", createTxHash);

      // Step 3: Confirm token creation (parse CurveCreate event)
      setStep("confirming");

      const tokenConfirmResponse = await fetch(`/api/agents/${agentId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: createTxHash }),
      });

      const tokenConfirmData = await tokenConfirmResponse.json();
      if (!tokenConfirmData.success) {
        throw new Error(tokenConfirmData.error || "Failed to confirm token creation");
      }

      setCreatedAgent((prev: any) => ({
        ...prev,
        nadfun: {
          token_address: tokenConfirmData.data?.token_address,
          token_url: tokenConfirmData.data?.token_url,
        },
      }));

      // Step 4: User signs two USDC transfers — seed to agent, fee to platform
      setStep("funding");

      const totalUsdc = parseFloat(formData.seedAmount);
      const agentSeed = totalUsdc - REGISTRATION_FEE_USDC;
      const agentSeedRaw = parseUnits(agentSeed.toFixed(USDC_DECIMALS), USDC_DECIMALS);
      const feeRaw = parseUnits(REGISTRATION_FEE_USDC.toFixed(USDC_DECIMALS), USDC_DECIMALS);

      // Transfer 1: Seed to agent wallet
      const seedTransferData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [data.data.wallet_address as `0x${string}`, agentSeedRaw],
      });

      const seedTxHash = await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from: connectedWallet.address,
          to: USDC_ADDRESS,
          data: seedTransferData,
          chainId: "0x" + CHAIN_ID.toString(16),
        }],
      });

      console.log("USDC Seed TX:", seedTxHash);

      // Transfer 2: Registration fee to platform wallet
      const feeTransferData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [PLATFORM_WALLET as `0x${string}`, feeRaw],
      });

      const feeTxHash = await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from: connectedWallet.address,
          to: USDC_ADDRESS,
          data: feeTransferData,
          chainId: "0x" + CHAIN_ID.toString(16),
        }],
      });

      console.log("Platform Fee TX:", feeTxHash);

      // Step 5: Confirm funding
      const confirmResponse = await fetch(`/api/agents/${agentId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: seedTxHash }),
      });

      const confirmData = await confirmResponse.json();
      if (!confirmData.success) {
        throw new Error(confirmData.error || "Failed to confirm funding");
      }

      setStep("complete");
      setCreatedAgent((prev: any) => ({ ...prev, confirmData }));

    } catch (err) {
      console.error("Error creating agent:", err);
      setError(err instanceof Error ? err.message : "Failed to create agent");
      setStep("form");
    }
  };

  const renderForm = () => (
    <div className="space-y-6">
      {/* Agent Name */}
      <div>
        <label className="block text-xs text-neutral-400 uppercase tracking-wider mb-2">
          Agent Name
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => handleInputChange("name", e.target.value)}
          placeholder="e.g., ElectroBot Pro"
          className="w-full px-4 py-3 bg-void border border-neutral-700 rounded-lg text-neutral-100
                     placeholder-neutral-600 focus:border-cyber-500 focus:outline-none transition-colors"
        />
      </div>

      {/* Token Symbol */}
      <div>
        <label className="block text-xs text-neutral-400 uppercase tracking-wider mb-2">
          Token Symbol
        </label>
        <input
          type="text"
          value={formData.tokenSymbol}
          onChange={(e) => handleInputChange("tokenSymbol", e.target.value.toUpperCase().slice(0, 6))}
          placeholder="e.g., EBOT"
          maxLength={6}
          className="w-full px-4 py-3 bg-void border border-neutral-700 rounded-lg text-neutral-100
                     placeholder-neutral-600 focus:border-cyber-500 focus:outline-none transition-colors uppercase"
        />
        <p className="text-xs text-neutral-500 mt-1">
          Max 6 characters. Your agent&apos;s token ticker on nad.fun.
        </p>
      </div>

      {/* Agent Type */}
      <div>
        <label className="block text-xs text-neutral-400 uppercase tracking-wider mb-2">
          Agent Type
        </label>
        <div className="grid grid-cols-2 gap-3">
          {AGENT_TYPES.map((type) => (
            <button
              key={type.value}
              onClick={() => handleInputChange("type", type.value)}
              className={`p-4 rounded-lg border text-left transition-all ${
                formData.type === type.value
                  ? "border-cyber-500 bg-cyber-500/10"
                  : "border-neutral-700 hover:border-neutral-600"
              }`}
            >
              <div className="text-sm font-medium text-neutral-200">{type.label}</div>
              <div className="text-xs text-neutral-500 mt-1">{type.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Personality */}
      <div>
        <label className="block text-xs text-neutral-400 uppercase tracking-wider mb-2">
          Agent Personality
        </label>
        <div className="grid grid-cols-2 gap-3">
          {PERSONALITIES.map((p) => (
            <button
              key={p.value}
              onClick={() => handleInputChange("personality", p.value)}
              className={`p-4 rounded-lg border text-left transition-all ${
                formData.personality === p.value
                  ? "border-purple-500 bg-purple-500/10"
                  : "border-neutral-700 hover:border-neutral-600"
              }`}
            >
              <div className="text-sm font-medium text-neutral-200">{p.label}</div>
              <div className="text-xs text-neutral-500 mt-1">{p.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs text-neutral-400 uppercase tracking-wider mb-2">
          Description
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => handleInputChange("description", e.target.value)}
          placeholder="Describe what your agent does and its personality..."
          rows={3}
          className="w-full px-4 py-3 bg-void border border-neutral-700 rounded-lg text-neutral-100
                     placeholder-neutral-600 focus:border-cyber-500 focus:outline-none transition-colors resize-none"
        />
      </div>

      {/* Seed Investment */}
      <div>
        <label className="block text-xs text-neutral-400 uppercase tracking-wider mb-2">
          Seed Investment (Required)
        </label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={MIN_SEED_USDC}
            step="0.1"
            value={formData.seedAmount}
            onChange={(e) => handleInputChange("seedAmount", e.target.value)}
            className="w-32 px-4 py-3 bg-void border border-neutral-700 rounded-lg text-neutral-100
                       focus:border-cyber-500 focus:outline-none transition-colors"
          />
          <span className="text-neutral-400">USDC</span>
        </div>
        <div className="text-xs text-neutral-500 mt-2 space-y-1">
          <p>Platform fee: <span className="text-amber-400">${REGISTRATION_FEE_USDC.toFixed(2)} USDC</span> (deducted from seed)</p>
          <p>Agent receives: <span className="text-emerald-400">${Math.max(0, parseFloat(formData.seedAmount || "0") - REGISTRATION_FEE_USDC).toFixed(2)} USDC</span> for operations</p>
          <p>Min {MIN_SEED_USDC} USDC total.</p>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {!authenticated ? (
        <button
          onClick={() => login()}
          className="w-full py-4 bg-cyber-500 hover:bg-cyber-400 text-void font-medium rounded-lg
                     transition-colors uppercase tracking-wider"
        >
          Connect Wallet to Create
        </button>
      ) : !connectedWallet ? (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 text-sm">
          Waiting for wallet connection...
        </div>
      ) : (
        <button
          onClick={handleSubmit}
          className="w-full py-4 bg-cyber-500 hover:bg-cyber-400 text-void font-medium rounded-lg
                     transition-colors uppercase tracking-wider"
        >
          Review & Create
        </button>
      )}
    </div>
  );

  const renderConfirm = () => (
    <div className="space-y-6">
      <div className="bg-surface border border-neutral-700 rounded-lg p-6 space-y-4">
        <h3 className="text-lg font-medium text-neutral-200">Confirm Agent Creation</h3>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-neutral-400">Name</span>
            <span className="text-neutral-200">{formData.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Token Symbol</span>
            <span className="text-cyber-400">${formData.tokenSymbol.toUpperCase()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Type</span>
            <span className="text-neutral-200">{formData.type}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Personality</span>
            <span className="text-purple-400 capitalize">{formData.personality}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Seed Investment</span>
            <span className="text-emerald-400">{formData.seedAmount} USDC</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-neutral-500 pl-2">Platform fee</span>
            <span className="text-amber-400">-${REGISTRATION_FEE_USDC.toFixed(2)} USDC</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-neutral-500 pl-2">Agent operating funds</span>
            <span className="text-emerald-400">${Math.max(0, parseFloat(formData.seedAmount) - REGISTRATION_FEE_USDC).toFixed(2)} USDC</span>
          </div>
        </div>

        <div className="border-t border-neutral-700 pt-4 mt-4">
          <div className="text-xs text-neutral-500 space-y-1">
            <p>You will sign 2 transactions:</p>
            <p>1. Deploy ${formData.tokenSymbol.toUpperCase()} token on nad.fun (costs ~10 MON)</p>
            <p>2. Send {formData.seedAmount} USDC to fund the agent (${REGISTRATION_FEE_USDC.toFixed(2)} platform fee + ${Math.max(0, parseFloat(formData.seedAmount) - REGISTRATION_FEE_USDC).toFixed(2)} operating funds)</p>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => setStep("form")}
          className="flex-1 py-3 border border-neutral-600 text-neutral-300 rounded-lg
                     hover:border-neutral-500 transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleConfirm}
          className="flex-1 py-3 bg-cyber-500 hover:bg-cyber-400 text-void font-medium rounded-lg
                     transition-colors"
        >
          Create Agent
        </button>
      </div>
    </div>
  );

  const renderProgress = () => {
    const steps = [
      { key: "creating", label: "Preparing agent + nad.fun token..." },
      { key: "signing", label: "Sign token creation TX (nad.fun)" },
      { key: "confirming", label: "Confirming token on chain..." },
      { key: "funding", label: "Sign USDC seed transfer" },
      { key: "complete", label: "Complete!" },
    ];

    const currentIndex = steps.findIndex((s) => s.key === step);

    return (
      <div className="space-y-6">
        <div className="space-y-3">
          {steps.map((s, i) => (
            <div
              key={s.key}
              className={`flex items-center gap-3 p-3 rounded-lg ${
                i < currentIndex
                  ? "bg-green-500/10 text-green-400"
                  : i === currentIndex
                  ? "bg-cyber-500/10 text-cyber-400"
                  : "bg-neutral-800/50 text-neutral-500"
              }`}
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                i < currentIndex
                  ? "bg-green-500 text-void"
                  : i === currentIndex
                  ? "bg-cyber-500 text-void animate-pulse"
                  : "bg-neutral-700"
              }`}>
                {i < currentIndex ? "\u2713" : i + 1}
              </div>
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}
      </div>
    );
  };

  const nadfunTokenUrl = createdAgent?.nadfun?.token_url;
  const tokenAddress = createdAgent?.nadfun?.token_address || createdAgent?.data?.token_address;

  const renderComplete = () => (
    <div className="space-y-6 text-center">
      <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
        <span className="text-3xl">{"\u2713"}</span>
      </div>

      <div>
        <h3 className="text-xl font-medium text-neutral-200 mb-2">Agent Created!</h3>
        <p className="text-neutral-400">
          Your agent <span className="text-cyber-400">{formData.name}</span> (${formData.tokenSymbol.toUpperCase()}) is now live.
        </p>
      </div>

      <div className="bg-surface border border-neutral-700 rounded-lg p-4 text-left space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-neutral-400">Agent ID</span>
          <span className="text-neutral-200 font-mono">{createdAgent?.data?.id?.slice(0, 8)}...</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-400">Token Symbol</span>
          <span className="text-cyber-400">${formData.tokenSymbol.toUpperCase()}</span>
        </div>
        {tokenAddress && (
          <div className="flex justify-between">
            <span className="text-neutral-400">Token Address</span>
            <span className="text-neutral-200 font-mono">{tokenAddress.slice(0, 10)}...</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-neutral-400">Personality</span>
          <span className="text-purple-400 capitalize">{formData.personality}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-400">Seed Funds</span>
          <span className="text-emerald-400">{formData.seedAmount} USDC</span>
        </div>
      </div>

      {nadfunTokenUrl && (
        <a
          href={nadfunTokenUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg
                     transition-colors text-center"
        >
          View Token on nad.fun
        </a>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => router.push(`/agents/${createdAgent?.data?.id}`)}
          className="flex-1 py-3 bg-cyber-500 hover:bg-cyber-400 text-void font-medium rounded-lg
                     transition-colors"
        >
          View Agent
        </button>
        <button
          onClick={() => router.push("/agents")}
          className="flex-1 py-3 border border-neutral-600 text-neutral-300 rounded-lg
                     hover:border-neutral-500 transition-colors"
        >
          All Agents
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-void py-8">
      <div className="max-w-xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-neutral-100 uppercase tracking-wider mb-2">
            Create AI Agent
          </h1>
          <p className="text-neutral-400">
            Launch an autonomous AI agent with its own token on nad.fun.
            Once deployed, your agent makes its own financial decisions &mdash;
            you&apos;re the creator and a stakeholder, not the operator.
          </p>
        </div>

        {/* Content */}
        <div className="bg-surface border border-neutral-800 rounded-lg p-6">
          {step === "form" && renderForm()}
          {step === "confirm" && renderConfirm()}
          {(step === "creating" || step === "signing" || step === "confirming" || step === "funding") && renderProgress()}
          {step === "complete" && renderComplete()}
        </div>

        {/* Info Box */}
        {step === "form" && (
          <div className="mt-6 p-4 bg-cyber-500/5 border border-cyber-500/20 rounded-lg">
            <h4 className="text-sm font-medium text-cyber-400 mb-2">How it works</h4>
            <ul className="text-xs text-neutral-400 space-y-1">
              <li>&#8226; You create the agent and deploy its token on nad.fun</li>
              <li>&#8226; Your seed investment funds the agent&apos;s operations</li>
              <li>&#8226; The agent works autonomously, earning revenue from tasks</li>
              <li>&#8226; Anyone can buy/sell the agent&apos;s token on nad.fun&apos;s bonding curve</li>
              <li>&#8226; Token price reflects the agent&apos;s performance and market demand</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
