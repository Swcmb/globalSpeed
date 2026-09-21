import { gvar } from "@/globalVar"
import { IS_DOUYIN, IS_VKBROTHER } from "./isWebsite"

// 针对抖音等主动覆盖 playbackRate 的站点
class AggressiveRateLocker {
	intervalId: number | null = null
	targetSpeed = 1
	active = false

	constructor() {
		if (!IS_DOUYIN && !IS_VKBROTHER) return
	}

	start(speed: number) {
		if (this.active) return
		this.active = true
		this.targetSpeed = speed

		// 每 100ms 检查一次并重新设置速度
		this.intervalId = window.setInterval(() => {
			this.lockSpeed()
		}, 100)
	}

	stop() {
		if (!this.active) return
		this.active = false
		if (this.intervalId) {
			window.clearInterval(this.intervalId)
			this.intervalId = null
		}
	}

	updateSpeed(speed: number) {
		this.targetSpeed = speed
	}

	private lockSpeed() {
		if (!gvar.os?.mediaTower) return

		gvar.os.mediaTower.media.forEach((elem) => {
			if (elem.tagName !== "VIDEO" && elem.tagName !== "AUDIO") return
			if (!elem.isConnected || elem.paused) return

			try {
				if (Math.abs(elem.playbackRate - this.targetSpeed) > 0.001) {
					elem.playbackRate = this.targetSpeed
				}
			} catch (e) {
				// 忽略设置错误
			}
		})
	}
}

// 金榜时代 BPlayer 适配器,拦截 setSpeed 方法
class BPlayerAdapter {
	static initialized = false
	static originalSetSpeed: ((speed: number) => void) | null = null
	static playerInstance: any = null
	static targetSpeed = 1

	static init() {
		if (this.initialized || !IS_VKBROTHER) return
		this.initialized = true

		this.waitForBPlayer()
	}

	private static waitForBPlayer() {
		if (this.findBPlayer()) {
			this.interceptBPlayer()
			return
		}

		const observer = new MutationObserver(() => {
			if (this.findBPlayer()) {
				observer.disconnect()
				this.interceptBPlayer()
			}
		})

		observer.observe(document.body, {
			childList: true,
			subtree: true,
		})

		// 30秒后停止等待
		setTimeout(() => observer.disconnect(), 30000)
	}

	private static findBPlayer(): boolean {
		try {
			if ((window as any).BPlayer) return true
			if ((window as any).baijiayun?.BPlayer) return true

			const playerEl =
				document.querySelector(".bplayer-video")?.closest(".bplayer") ||
				document.querySelector(".bplayer-wrap") ||
				document.querySelector("[class*='bplayer']")

			if (playerEl) {
				for (const key in playerEl) {
					if (key.startsWith("__bplayer") || key.startsWith("_player")) {
						return true
					}
				}
			}
		} catch (e) {}
		return false
	}

	private static interceptBPlayer() {
		try {
			const BPlayerCtor = (window as any).BPlayer || (window as any).baijiayun?.BPlayer

			if (BPlayerCtor?.prototype?.setSpeed) {
				this.originalSetSpeed = BPlayerCtor.prototype.setSpeed

				BPlayerCtor.prototype.setSpeed = function (speed: number) {
					// 使用全局速度
					if (BPlayerAdapter.targetSpeed !== 1) {
						speed = BPlayerAdapter.targetSpeed
					}

					// BPlayer 限制 0.5x-2x
					const clampedSpeed = Math.max(0.5, Math.min(2, speed))

					// 如果超出范围,直接设置 video.playbackRate
					if (Math.abs(clampedSpeed - speed) > 0.01) {
						if (this.video) {
							try {
								this.video.playbackRate = speed
							} catch (e) {}
						}
					}

					return BPlayerAdapter.originalSetSpeed!.call(this, clampedSpeed)
				}

				this.watchForBPlayerInstance(BPlayerCtor)
			}
		} catch (e) {
			console.warn("[GlobalSpeed] BPlayer interception failed:", e)
		}
	}

	private static watchForBPlayerInstance(BPlayerCtor: any) {
		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === "childList") {
					for (const node of mutation.addedNodes) {
						if (node instanceof HTMLElement) {
							const playerEl = node.querySelector?.(".bplayer-video") || node.querySelector?.("[class*='bplayer']")

							if (playerEl && !this.playerInstance) {
								this.playerInstance = playerEl
							}
						}
					}
				}
			}
		})

		observer.observe(document.body, {
			childList: true,
			subtree: true,
		})
	}

	static updateSpeed(speed: number) {
		this.targetSpeed = speed

		if (this.playerInstance?.setSpeed) {
			try {
				this.playerInstance.setSpeed(speed)
			} catch (e) {
				// 忽略错误
			}
		}
	}

	static release() {
		this.initialized = false
		this.playerInstance = null
		this.targetSpeed = 1
	}
}

export const aggressiveRateLocker = new AggressiveRateLocker()
export { BPlayerAdapter }
