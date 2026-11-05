import ExpoModulesCore
import UIKit

/// 端末で使えるフォントのファミリー名を返す。
/// expo-font の getLoadedFonts はアプリに同梱したものしか返さないので、ここで取る。
public class EmberFontsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("EmberFonts")

    Function("getFontFamilies") { () -> [String] in
      return UIFont.familyNames
    }
  }
}
