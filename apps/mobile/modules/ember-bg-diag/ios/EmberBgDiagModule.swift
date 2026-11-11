import BackgroundTasks
import ExpoModulesCore
import UIKit

/// 通知の巡回が動かないときの切り分け用（§9-8）。読むだけで、予約や登録は変えない。
/// expo-background-task は OS への予約の失敗を捨てるので、予約が入っているかをここで見る。
public class EmberBgDiagModule: Module {
  public func definition() -> ModuleDefinition {
    Name("EmberBgDiag")

    /// 「App のバックグラウンド更新」の状態。'available' | 'denied' | 'restricted' | 'unknown'
    AsyncFunction("getBackgroundRefreshStatus") { () -> String in
      switch UIApplication.shared.backgroundRefreshStatus {
      case .available: return "available"
      case .denied: return "denied"
      case .restricted: return "restricted"
      @unknown default: return "unknown"
      }
    }
    .runOnQueue(.main)

    /// OS に入っている予約。identifier と earliestBeginDate（ミリ秒。無ければキーごと無い）
    AsyncFunction("getPendingTaskRequests") { (promise: Promise) in
      BGTaskScheduler.shared.getPendingTaskRequests { requests in
        let list: [[String: Any]] = requests.map { r in
          var item: [String: Any] = ["identifier": r.identifier]
          if let date = r.earliestBeginDate {
            item["earliestBeginDate"] = date.timeIntervalSince1970 * 1000
          }
          return item
        }
        promise.resolve(list)
      }
    }
  }
}
